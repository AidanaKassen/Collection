// Правила: причина неоплаты, приоритет, рекомендованное действие, автопоследовательности.
(function () {
  const REASONS = {
    dispute:        { label: "Спор по счёту",          tone: "violet" },
    payment_failed: { label: "Сбой платежа",           tone: "blue" },
    admin:          { label: "Бюрократия / согласование", tone: "slate" },
    hardship:       { label: "Финансовые трудности",   tone: "amber" },
    churn_risk:     { label: "Риск оттока",            tone: "rose" },
    unresponsive:   { label: "Нет ответа",             tone: "red" },
    forgot:         { label: "Забыли оплатить",        tone: "green" },
    promise:        { label: "Обещание оплаты",        tone: "teal" },
    unknown:        { label: "Не определена",          tone: "slate" },
  };

  const ACTIONS = {
    reminder:      { label: "Отправить вежливое напоминание", channel: "email" },
    card_update:   { label: "Отправить ссылку на обновление карты", channel: "email" },
    retry_charge:  { label: "Повторить списание", channel: "system" },
    resolve_dispute:{ label: "Передать аккаунт-менеджеру и скорректировать счёт", channel: "task" },
    po_request:    { label: "Запросить PO / документы для бухгалтерии", channel: "email" },
    payment_plan:  { label: "Предложить график рассрочки", channel: "email" },
    cs_checkin:    { label: "Подключить Customer Success", channel: "task" },
    call:          { label: "Позвонить контакту", channel: "call" },
    find_contact:  { label: "Найти другой контакт (ЛПР / бухгалтерия)", channel: "task" },
    wait_promise:  { label: "Ждать оплату по обещанию", channel: "none" },
    final_notice:  { label: "Направить уведомление о приостановке", channel: "email" },
    suspend:       { label: "Приостановить сервис", channel: "system" },
    agency:        { label: "Передать в коллекторское агентство / юристам", channel: "task" },
    ask_reason:    { label: "Выяснить причину неоплаты", channel: "email" },
  };

  const TEMPLATES = {
    reminder: { subject: "Напоминание: счёт {invoices} к оплате",
      body: "Здравствуйте, {contact}!\n\nНапоминаем, что по счёту {invoices} на сумму {amount} срок оплаты истёк {days} дн. назад. Возможно, платёж просто затерялся.\n\nОплатить можно по ссылке: {link}\n\nЕсли оплата уже отправлена, просто ответьте на это письмо.\n\nС уважением,\nкоманда биллинга" },
    card_update: { subject: "Не удалось списать оплату по подписке",
      body: "Здравствуйте, {contact}!\n\nМы не смогли списать оплату {amount} ({cardReason}). Чтобы сервис для {company} работал без перерывов, обновите платёжные данные по ссылке: {link}\n\nПосле обновления мы повторим списание автоматически." },
    po_request: { subject: "Документы для оплаты счёта {invoices}",
      body: "Здравствуйте, {contact}!\n\nЧтобы ускорить согласование счёта {invoices} ({amount}), подскажите, какие документы нужны вашей бухгалтерии: номер PO, акт сверки или закрывающие документы? Мы подготовим их в течение дня." },
    payment_plan: { subject: "Вариант рассрочки для {company}",
      body: "Здравствуйте, {contact}!\n\nПонимаем, что сейчас может быть непростой период. Предлагаем разбить задолженность {amount} на 3 ежемесячных платежа без штрафов. Подтвердите, пожалуйста, ответом на письмо, и мы пришлём обновлённый график." },
    ask_reason: { subject: "Счёт {invoices}: нужна ваша помощь",
      body: "Здравствуйте, {contact}!\n\nСчёт {invoices} на {amount} просрочен на {days} дн. Подскажите, есть ли вопросы к счёту или что-то мешает оплате? Мы поможем решить вопрос." },
    final_notice: { subject: "Уведомление о приостановке сервиса",
      body: "Здравствуйте, {contact}!\n\nЗадолженность {company} составляет {amount} и просрочена на {days} дн. Если оплата не поступит в течение 7 дней, доступ к сервису будет приостановлен.\n\nСсылка на оплату: {link}" },
    call: { subject: "Звонок по задолженности",
      body: "Скрипт: представиться, уточнить статус оплаты {invoices} ({amount}), выяснить причину задержки, зафиксировать дату обещанной оплаты." },
  };

  function today(state) { return state.day; }

  function openInvoices(acc, day) {
    return acc.invoices.filter(function (v) { return v.paid < v.amount && v.due < day; });
  }
  function balance(acc, day) {
    return openInvoices(acc, day).reduce(function (s, v) { return s + v.amount - v.paid; }, 0);
  }
  function daysOverdue(acc, day) {
    const open = openInvoices(acc, day);
    if (!open.length) return 0;
    return day - Math.min.apply(null, open.map(function (v) { return v.due; }));
  }

  function promiseStatus(acc, day) {
    const p = acc.signals.promise;
    if (!p) return null;
    if (balance(acc, day) === 0) return "kept";
    return p.day >= day ? "active" : "broken";
  }

  function classify(acc, day) {
    const s = acc.signals, ev = [];
    const d = daysOverdue(acc, day);
    let code;
    const ps = promiseStatus(acc, day);
    if (acc.reasonOverride) {
      code = acc.reasonOverride; ev.push("Причина задана вручную");
      return { code: code, confidence: 1, evidence: ev };
    }
    if (s.dispute) { code = "dispute"; ev.push("Клиент оспаривает счёт: " + s.dispute); }
    else if (s.cardFailed) { code = "payment_failed"; ev.push("Автосписание не прошло: " + s.cardFailReason); if (acc.onTimeRate > 0.8) ev.push("Раньше платили вовремя (" + Math.round(acc.onTimeRate * 100) + "%)"); }
    else if (ps === "active") { code = "promise"; ev.push("Клиент обещал оплатить до " + window.fmtDay(s.promise.day)); }
    else if (s.poRequired) { code = "admin"; ev.push(s.apNote); }
    else if (s.installmentRequest || s.partialPayments) {
      code = "hardship";
      if (s.partialPayments) ev.push("Частичная оплата счёта");
      if (s.installmentRequest) ev.push("Клиент просил рассрочку");
    }
    else if (s.usageDrop >= 40 && s.openTickets >= 2) { code = "churn_risk"; ev.push("Использование упало на " + s.usageDrop + "%"); ev.push(s.openTickets + " открытых обращения в поддержку"); }
    else if (s.bounced || s.lastReplyDaysAgo > 21) {
      code = "unresponsive";
      if (s.bounced) ev.push("Письма на " + acc.contact.email + " не доставляются");
      if (s.lastReplyDaysAgo > 21) ev.push("Последний ответ " + s.lastReplyDaysAgo + " дн. назад");
    }
    else if (acc.onTimeRate >= 0.85 && d <= 20) { code = "forgot"; ev.push("Платят вовремя в " + Math.round(acc.onTimeRate * 100) + "% случаев"); ev.push("Просрочка небольшая: " + d + " дн."); }
    else { code = "unknown"; ev.push("Нет явных сигналов, нужно связаться с клиентом"); }
    if (ps === "broken") ev.push("Обещание оплатить до " + window.fmtDay(s.promise.day) + " нарушено");
    const conf = code === "unknown" ? 0.4 : (ev.length > 1 ? 0.9 : 0.75);
    return { code: code, confidence: conf, evidence: ev };
  }

  function recommend(acc, day, reason) {
    const d = daysOverdue(acc, day);
    const ps = promiseStatus(acc, day);
    const s = acc.signals;
    let code, why;
    if (ps === "broken" && d < 75) { code = "call"; why = "Обещание нарушено: нужен живой разговор и новая дата"; }
    else if (d >= 90 && reason.code !== "dispute") { code = "agency"; why = "Просрочка более 90 дней, досудебные меры исчерпаны"; }
    else if (d >= 60 && reason.code !== "dispute" && reason.code !== "admin") { code = s.suspendNoticeSent ? "suspend" : "final_notice"; why = s.suspendNoticeSent ? "Уведомление уже отправлено, срок истёк" : "Просрочка более 60 дней"; }
    else switch (reason.code) {
      case "promise": code = "wait_promise"; why = "Срок обещания ещё не наступил"; break;
      case "dispute": code = "resolve_dispute"; why = "Пока спор не закрыт, напоминания не сработают"; break;
      case "payment_failed": code = s.cardLinkSent ? "retry_charge" : "card_update"; why = s.cardLinkSent ? "Ссылка отправлена, пробуем списать снова" : "Технический сбой оплаты, клиент обычно платит сам"; break;
      case "admin": code = "po_request"; why = "Оплата заблокирована внутренним согласованием клиента"; break;
      case "hardship": code = "payment_plan"; why = "Рассрочка повышает шанс возврата и сохраняет клиента"; break;
      case "churn_risk": code = "cs_checkin"; why = "Неоплата связана с недовольством продуктом"; break;
      case "unresponsive": code = s.bounced ? "find_contact" : "call"; why = s.bounced ? "Email не доставляется" : "Письма остаются без ответа"; break;
      case "forgot": code = "reminder"; why = "Надёжный плательщик, достаточно напоминания"; break;
      default: code = d > 30 ? "call" : "ask_reason"; why = "Нужно выяснить причину";
    }
    return Object.assign({ code: code, why: why }, ACTIONS[code]);
  }

  const REASON_WEIGHT = { unresponsive: 1.25, churn_risk: 1.2, hardship: 1.15, unknown: 1.1, dispute: 1.0,
    admin: 0.85, payment_failed: 0.8, forgot: 0.7, promise: 0.6 };

  function priority(acc, day, reason) {
    const bal = balance(acc, day);
    if (!bal) return 0;
    const d = daysOverdue(acc, day);
    const amountScore = Math.min(1, Math.log10(bal / 50000) / Math.log10(200)); // 50k..10M
    const ageScore = Math.min(1, d / 90);
    let score = (amountScore * 0.5 + ageScore * 0.5) * 100 * (REASON_WEIGHT[reason.code] || 1);
    if (promiseStatus(acc, day) === "broken") score += 12;
    return Math.max(1, Math.min(100, Math.round(score)));
  }
  function tier(score) {
    if (score >= 75) return { key: "crit", label: "Критично" };
    if (score >= 55) return { key: "high", label: "Высокий" };
    if (score >= 35) return { key: "med", label: "Средний" };
    return { key: "low", label: "Низкий" };
  }

  // Автопоследовательности по причине: шаги со смещением в днях от запуска.
  const PLAYBOOKS = {
    forgot:         [[0, "reminder"], [3, "reminder"], [7, "call"]],
    payment_failed: [[0, "card_update"], [2, "retry_charge"], [5, "card_update"], [9, "call"]],
    admin:          [[0, "po_request"], [4, "call"], [10, "po_request"]],
    hardship:       [[0, "payment_plan"], [5, "call"], [12, "final_notice"]],
    churn_risk:     [[0, "cs_checkin"], [3, "ask_reason"], [10, "call"]],
    unresponsive:   [[0, "ask_reason"], [2, "call"], [6, "final_notice"], [13, "suspend"]],
    unknown:        [[0, "ask_reason"], [4, "call"], [10, "final_notice"]],
    dispute:        [[0, "resolve_dispute"], [5, "reminder"]],
    promise:        [[0, "wait_promise"], [1, "reminder"]],
  };

  window.Engine = {
    REASONS: REASONS, ACTIONS: ACTIONS, TEMPLATES: TEMPLATES, PLAYBOOKS: PLAYBOOKS,
    openInvoices: openInvoices, balance: balance, daysOverdue: daysOverdue,
    promiseStatus: promiseStatus, classify: classify, recommend: recommend,
    priority: priority, tier: tier, today: today,
  };
})();
