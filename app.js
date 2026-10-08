// Рабочее пространство взыскания: очередь, карточка клиента, задачи, коммуникации, аналитика.
(function () {
  const E = window.Engine;
  const KEY = "genie-collections-v1";
  const CUR = "₸";
  const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  let state = load() || fresh();
  const ui = { tab: "queue", reasons: new Set(), tierF: "all", owner: "all", q: "", open: null, selected: new Set(), draft: null, toast: null };

  function fresh() {
    const s = window.generateSeed();
    const d = new Date(); d.setHours(12, 0, 0, 0);
    s.base = d.toISOString();
    return s;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* демо работает и без хранилища */ } }

  window.fmtDay = function (day) {
    const d = new Date(state.base); d.setDate(d.getDate() + day);
    return d.getDate() + " " + MONTHS[d.getMonth()];
  };
  function money(n) { return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ") + " " + CUR; }
  function short(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " млн " + CUR;
    if (n >= 1e3) return Math.round(n / 1e3) + " тыс " + CUR;
    return money(n);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function acc(id) { return state.accounts.find(function (a) { return a.id === id; }); }
  function nid(p) { state.seq += 1; return p + state.seq; }
  function rel(day) {
    const d = day - state.day;
    if (d === 0) return "сегодня"; if (d === 1) return "завтра"; if (d === -1) return "вчера";
    return d > 0 ? "через " + d + " дн." : d * -1 + " дн. назад";
  }

  // ---------- Вычисления по клиенту ----------
  function view(a) {
    const day = state.day;
    const reason = E.classify(a, day);
    const bal = E.balance(a, day);
    const score = E.priority(a, day, reason);
    return { a: a, reason: reason, bal: bal, days: E.daysOverdue(a, day), score: score, tier: E.tier(score),
      reco: E.recommend(a, day, reason), open: E.openInvoices(a, day), promise: E.promiseStatus(a, day) };
  }
  function overdueViews() {
    return state.accounts.map(view).filter(function (v) { return v.bal > 0; }).sort(function (x, y) { return y.score - x.score; });
  }

  // ---------- Шаблоны ----------
  function fill(tpl, v) {
    const a = v.a;
    const map = {
      contact: a.contact.name.split(" ")[0], company: a.name, amount: money(v.bal), days: v.days,
      invoices: v.open.map(function (i) { return i.number; }).join(", ") || "—",
      link: "pay.geniemap.kz/" + a.id, cardReason: (a.signals.cardFailReason || "").toLowerCase(),
    };
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
  }
  function draftFor(v, code) {
    const t = E.TEMPLATES[code] || E.TEMPLATES[{ suspend: "final_notice", retry_charge: "card_update" }[code]];
    return t ? { subject: fill(t.subject, v), body: fill(t.body, v) } : { subject: E.ACTIONS[code].label, body: "" };
  }

  // ---------- Действия ----------
  function logComm(a, o) {
    state.comms.push(Object.assign({ id: nid("c"), accountId: a.id, day: state.day }, o));
  }
  function addTask(a, title, inDays) {
    state.tasks.push({ id: nid("t"), accountId: a.id, due: state.day + inDays, title: title, done: false });
  }
  function recordPayment(a, amount, note) {
    let left = amount;
    a.invoices.slice().sort(function (x, y) { return x.due - y.due; }).forEach(function (inv) {
      if (left <= 0 || inv.paid >= inv.amount) return;
      const pay = Math.min(left, inv.amount - inv.paid);
      inv.paid += pay; left -= pay;
      if (inv.paid >= inv.amount) inv.paidOn = state.day;
    });
    const paid = amount - left;
    state.recoveredLog.push({ day: state.day, accountId: a.id, amount: paid, reason: E.classify(a, state.day).code });
    a.payments.push({ day: state.day, amount: paid });
    logComm(a, { channel: "payment", subject: "Поступила оплата " + money(paid), body: note || "", status: "Оплата", inbound: true });
    if (E.balance(a, state.day) === 0) {
      if (a.automation) a.automation.stopped = "Погашено";
      a.signals.cardFailed = false; a.signals.partialPayments = false; a.signals.installmentRequest = false;
      state.tasks.forEach(function (t) { if (t.accountId === a.id && !t.done) t.done = true; });
    }
    return paid;
  }

  // Выполнить действие: auto=true — из автопоследовательности
  function execute(a, code, draft, auto) {
    const s = a.signals;
    const act = E.ACTIONS[code];
    const v = view(a);
    if (!draft) draft = draftFor(v, code);
    const base = { auto: !!auto, subject: draft.subject, body: draft.body, action: code };
    switch (code) {
      case "reminder": case "po_request": case "payment_plan": case "ask_reason":
        if (s.bounced && !auto) toast("Внимание: адрес " + a.contact.email + " ранее не принимал письма");
        logComm(a, Object.assign(base, { channel: "email", status: s.bounced ? "Не доставлено" : "Отправлено" }));
        if (code === "payment_plan") s.planOffered = true;
        if (code === "po_request") s.poRequested = true;
        break;
      case "card_update":
        logComm(a, Object.assign(base, { channel: "email", status: "Отправлено" })); s.cardLinkSent = true; break;
      case "final_notice":
        logComm(a, Object.assign(base, { channel: "email", status: s.bounced ? "Не доставлено" : "Отправлено" })); s.suspendNoticeSent = true; break;
      case "retry_charge": {
        const ok = s.cardLinkSent && rand(a, 7) < 0.6;
        logComm(a, Object.assign(base, { channel: "system", subject: "Повторное списание", body: ok ? "Списание прошло успешно." : "Банк отклонил списание.", status: ok ? "Успешно" : "Отказ" }));
        if (ok) { s.cardFailed = false; recordPayment(a, v.bal, "Автосписание с обновлённой карты"); }
        break;
      }
      case "call":
        if (auto) { addTask(a, "Позвонить: " + a.contact.name + ", " + a.contact.phone, 0); logComm(a, Object.assign(base, { channel: "task", subject: "Создана задача на звонок", status: "Задача" })); }
        else logComm(a, Object.assign(base, { channel: "call", subject: "Звонок " + a.contact.name, status: "Звонок выполнен" }));
        s.contacted = state.day;
        break;
      case "suspend":
        s.suspended = true; logComm(a, Object.assign(base, { channel: "system", subject: "Сервис приостановлен", body: "Доступ клиента ограничен до погашения задолженности.", status: "Приостановлено" })); break;
      case "agency":
        s.agency = true; addTask(a, "Подготовить пакет документов для коллекторского агентства", 2);
        logComm(a, Object.assign(base, { channel: "system", subject: "Передано во внешнее взыскание", body: "", status: "Эскалация" })); break;
      case "resolve_dispute": addTask(a, "Разобрать спор: " + (s.dispute || "проверить счёт"), 1);
        logComm(a, Object.assign(base, { channel: "task", subject: "Спор передан аккаунт-менеджеру " + a.owner, body: s.dispute || "", status: "Задача" })); break;
      case "cs_checkin": addTask(a, "Customer Success: созвон о проблемах с продуктом", 1);
        logComm(a, Object.assign(base, { channel: "task", subject: "Подключён Customer Success", body: "Открытых обращений: " + s.openTickets, status: "Задача" })); break;
      case "find_contact": addTask(a, "Найти актуальный контакт бухгалтерии / ЛПР", 1);
        logComm(a, Object.assign(base, { channel: "task", subject: "Поиск нового контакта", status: "Задача" })); break;
      case "wait_promise":
        if (!auto) toast("Ждём оплату до " + fmtDay(s.promise.day) + ". Напоминание придёт автоматически.");
        return;
    }
    if (code !== "call" && code !== "wait_promise") s.contacted = state.day;
    if (!auto && E.balance(a, state.day) > 0 && act.channel !== "task") addTask(a, "Проверить результат: " + act.label.toLowerCase(), 3);
  }

  function enroll(a) {
    const r = E.classify(a, state.day).code;
    a.automation = { playbook: r, start: state.day, done: [], stopped: null };
    runAutomation(a);
  }
  function runAutomation(a) {
    const au = a.automation;
    if (!au || au.stopped) return;
    if (E.balance(a, state.day) === 0) { au.stopped = "Погашено"; return; }
    if (a.signals.dispute && au.playbook !== "dispute") { au.stopped = "Пауза: открыт спор"; return; }
    (E.PLAYBOOKS[au.playbook] || []).forEach(function (st, i) {
      if (au.done.indexOf(i) >= 0 || au.start + st[0] > state.day) return;
      au.done.push(i);
      if (E.balance(a, state.day) > 0) execute(a, st[1], null, true);
    });
  }

  // детерминированная «случайность» для симуляции ответа клиента
  function rand(a, salt) {
    let h = 2166136261;
    const str = a.id + ":" + state.day + ":" + salt;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  function nextDay() {
    state.day += 1;
    let paidCount = 0, paidSum = 0, autoSent = 0;
    const before = state.comms.length;
    state.accounts.forEach(function (a) { runAutomation(a); });
    autoSent = state.comms.length - before;
    // ответы клиентов
    state.accounts.forEach(function (a) {
      const bal = E.balance(a, state.day);
      if (!bal) return;
      const s = a.signals, r = E.classify(a, state.day).code;
      const recent = s.contacted != null && state.day - s.contacted <= 4;
      let p = 0.02, part = 1;
      if (s.promise && s.promise.day === state.day && r === "promise") p = 0.8;
      else if (recent) {
        p = { forgot: 0.4, payment_failed: s.cardLinkSent ? 0.35 : 0.05, admin: s.poRequested ? 0.22 : 0.05, hardship: s.planOffered ? 0.35 : 0.06,
          churn_risk: 0.1, unresponsive: s.bounced ? 0.02 : 0.1, unknown: 0.18, dispute: 0.02, promise: 0.15 }[r] || 0.1;
        if (r === "hardship" && s.planOffered) part = 1 / 3;
        if (s.suspended) p += 0.25;
      }
      if (rand(a, 1) < p) {
        const amt = part < 1 ? Math.min(bal, Math.round(bal * part / 1000) * 1000) : bal;
        paidSum += recordPayment(a, amt, part < 1 ? "Платёж по графику рассрочки" : "Оплата по счёту");
        paidCount += 1;
      } else if (recent && r === "unknown" && rand(a, 2) < 0.3) {
        // клиент ответил и назвал причину
        s.promise = { day: state.day + 5, madeOn: state.day };
        logComm(a, { channel: "email", inbound: true, subject: "Re: нужна ваша помощь", body: "Оплатим до " + fmtDay(state.day + 5) + ", задержка была из-за смены бухгалтера.", status: "Обещание оплаты" });
      }
    });
    save(); render();
    toast(fmtDay(state.day) + ": автоматизация отправила " + autoSent + " сообщ., поступило оплат: " + paidCount + (paidSum ? " на " + short(paidSum) : ""));
  }

  // ---------- Рендер ----------
  const root = document.getElementById("app");

  function reasonPill(code) {
    const r = E.REASONS[code];
    return '<span class="pill tone-' + r.tone + '">' + esc(r.label) + "</span>";
  }
  function agingBlocks(days, tierKey) {
    const n = days > 90 ? 4 : days > 60 ? 3 : days > 30 ? 2 : 1;
    let h = '<span class="aging sev-' + tierKey + '" title="Корзина просрочки">';
    for (let i = 1; i <= 4; i++) h += '<i class="' + (i <= n ? "on" : "") + '"></i>';
    return h + "</span>";
  }

  function kpis(views) {
    const total = views.reduce(function (s, v) { return s + v.bal; }, 0);
    const recovered = state.recoveredLog.reduce(function (s, r) { return s + r.amount; }, 0);
    const start = state.startTotal || (state.startTotal = total);
    const promises = views.filter(function (v) { return v.promise === "active"; }).length;
    const tasksDue = state.tasks.filter(function (t) { return !t.done && t.due <= state.day; }).length;
    const crit = views.filter(function (v) { return v.tier.key === "crit"; }).length;
    return '<section class="kpis" aria-label="Сводка">' +
      k("Просроченная задолженность", short(total), views.length + " клиентов") +
      k("Критичный приоритет", String(crit), "требуют внимания сегодня") +
      k("Возвращено", short(recovered), Math.round(recovered / Math.max(1, start) * 100) + "% от стартового долга", recovered > 0) +
      k("Активные обещания", String(promises), "клиент назвал дату оплаты") +
      k("Задачи на сегодня", String(tasksDue), tasksDue ? "включая просроченные" : "всё сделано") +
      "</section>";
    function k(l, v, s, good) { return '<div class="kpi"><span class="label">' + l + '</span><span class="value' + (good ? " good" : "") + '">' + v + '</span><span class="sub">' + s + "</span></div>"; }
  }

  function queue(views) {
    const reasonCounts = {};
    views.forEach(function (v) { reasonCounts[v.reason.code] = (reasonCounts[v.reason.code] || 0) + 1; });
    const list = views.filter(function (v) {
      if (ui.reasons.size && !ui.reasons.has(v.reason.code)) return false;
      if (ui.tierF !== "all" && v.tier.key !== ui.tierF) return false;
      if (ui.owner !== "all" && v.a.owner !== ui.owner) return false;
      if (ui.q && (v.a.name + " " + v.a.contact.name).toLowerCase().indexOf(ui.q.toLowerCase()) < 0) return false;
      return true;
    });
    const owners = Array.from(new Set(state.accounts.map(function (a) { return a.owner; })));
    let h = '<div class="filters">' +
      '<input type="search" id="q" placeholder="Компания или контакт" value="' + esc(ui.q) + '" aria-label="Поиск">' +
      '<select id="tierF" aria-label="Приоритет"><option value="all">Любой приоритет</option>' +
      [["crit", "Критично"], ["high", "Высокий"], ["med", "Средний"], ["low", "Низкий"]].map(function (t) { return '<option value="' + t[0] + '"' + (ui.tierF === t[0] ? " selected" : "") + ">" + t[1] + "</option>"; }).join("") + "</select>" +
      '<select id="ownerF" aria-label="Ответственный"><option value="all">Все ответственные</option>' +
      owners.map(function (o) { return "<option" + (ui.owner === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></div>" +
      '<div class="chips" style="margin-bottom:12px">' +
      Object.keys(E.REASONS).filter(function (c) { return reasonCounts[c]; }).map(function (c) {
        return '<button class="chip" data-reason="' + c + '" aria-pressed="' + ui.reasons.has(c) + '">' + E.REASONS[c].label + ' <span class="num muted">' + reasonCounts[c] + "</span></button>";
      }).join("") + "</div>";
    if (ui.selected.size) {
      h += '<div class="bulk"><b>Выбрано: ' + ui.selected.size + '</b><button class="btn primary small" data-act="bulk-auto">Запустить автосценарий</button><button class="btn small" data-act="bulk-clear">Снять выбор</button><span class="note">Сценарий подбирается по причине неоплаты каждого клиента</span></div>';
    }
    if (!list.length) return h + '<div class="empty">Нет клиентов под эти фильтры.</div>';
    h += '<div class="table-wrap"><table><thead><tr><th style="width:28px"></th><th>Приоритет</th><th>Клиент</th><th class="r">Просрочено</th><th>Дней</th><th>Причина</th><th>Следующее действие</th><th>Автоматизация</th></tr></thead><tbody>';
    list.forEach(function (v) {
      const au = v.a.automation;
      h += '<tr class="row" data-open="' + v.a.id + '">' +
        '<td><input type="checkbox" data-sel="' + v.a.id + '" aria-label="Выбрать ' + esc(v.a.name) + '"' + (ui.selected.has(v.a.id) ? " checked" : "") + "></td>" +
        '<td><div class="prio sev-' + v.tier.key + '"><span class="score">' + v.score + '</span><span class="bar"><i style="width:' + v.score + '%"></i></span></div></td>' +
        '<td class="co">' + esc(v.a.name) + "<small>" + esc(v.a.plan) + " · " + esc(v.a.owner) + "</small></td>" +
        '<td class="r num">' + money(v.bal) + '<div class="muted" style="font-size:11.5px">' + v.open.length + " сч.</div></td>" +
        '<td><div class="inline"><span class="num">' + v.days + "</span>" + agingBlocks(v.days, v.tier.key) + "</div></td>" +
        "<td>" + reasonPill(v.reason.code) + (v.promise === "broken" ? ' <span class="pill tone-red">обещание нарушено</span>' : "") + "</td>" +
        '<td class="action-cell">' + esc(v.reco.label) + "</td>" +
        "<td>" + (au ? (au.stopped ? '<span class="muted" style="font-size:12px">' + esc(au.stopped) + "</span>" : '<span class="auto">● шаг ' + au.done.length + " из " + E.PLAYBOOKS[au.playbook].length + "</span>") : '<span class="muted" style="font-size:12px">выкл.</span>') + "</td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  function tasksView() {
    const open = state.tasks.filter(function (t) { return !t.done; }).sort(function (x, y) { return x.due - y.due; });
    const done = state.tasks.filter(function (t) { return t.done; }).slice(-8).reverse();
    function item(t) {
      const a = acc(t.accountId);
      return '<div class="item"><input type="checkbox" data-task="' + t.id + '"' + (t.done ? " checked" : "") + ' aria-label="Выполнено">' +
        '<div class="main"><b' + (t.done ? ' class="muted"' : "") + ">" + esc(t.title) + '</b><p><button class="link" data-open="' + a.id + '">' + esc(a.name) + "</button> · " + esc(a.owner) + "</p></div>" +
        '<div class="side ' + (!t.done && t.due < state.day ? "overdue-t" : "") + '">' + fmtDay(t.due) + "<br>" + rel(t.due) + "</div></div>";
    }
    return '<div class="section-title">Открытые · ' + open.length + "</div>" +
      (open.length ? '<div class="list">' + open.map(item).join("") + "</div>" : '<div class="list"><div class="empty">Все задачи выполнены.</div></div>') +
      (done.length ? '<div class="section-title">Недавно выполненные</div><div class="list">' + done.map(item).join("") + "</div>" : "");
  }

  const CH = { email: "Email", call: "Звонок", system: "Система", task: "Задача", payment: "Оплата" };
  function commsView() {
    const list = state.comms.slice().sort(function (x, y) { return y.day - x.day; }).slice(0, 80);
    if (!list.length) return '<div class="list"><div class="empty">Пока нет коммуникаций.</div></div>';
    return '<p class="note">Сообщения в демо не отправляются наружу: они только записываются в журнал, как если бы ушли клиенту.</p><div class="list">' + list.map(function (c) {
      const a = acc(c.accountId);
      return '<div class="item"><div class="main"><b>' + esc(c.subject) + "</b>" + (c.auto ? '<span class="tag auto">авто</span>' : "") + (c.inbound ? '<span class="tag">входящее</span>' : "") +
        '<p><button class="link" data-open="' + a.id + '">' + esc(a.name) + "</button> · " + CH[c.channel] + " · " + esc(c.status) + "</p></div>" +
        '<div class="side">' + fmtDay(c.day) + "</div></div>";
    }).join("") + "</div>";
  }

  function analytics(views) {
    // корзины просрочки
    const buckets = [["1–30", 0, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["90+", 91, 1e9]].map(function (b) {
      return { label: b[0], sum: views.filter(function (v) { return v.days >= b[1] && v.days <= b[2]; }).reduce(function (s, v) { return s + v.bal; }, 0) };
    });
    const maxB = Math.max.apply(null, buckets.map(function (b) { return b.sum; }).concat([1]));
    const W = 460, H = 220, pl = 10, pb = 28, pt = 22, bw = 70, gap = (W - pl * 2 - bw * 4) / 3;
    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Задолженность по сроку просрочки">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) { const y = H - pb - (H - pb - pt) * f; svg += '<line class="grid" x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>'; });
    const sev = ["var(--med)", "var(--high)", "var(--crit)", "var(--crit)"];
    buckets.forEach(function (b, i) {
      const h = (H - pb - pt) * b.sum / maxB, x = pl + i * (bw + gap), y = H - pb - h;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, h) + '" rx="4" fill="' + sev[i] + '" opacity="' + (i === 3 ? 1 : 0.85) + '"/>' +
        '<text class="v" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + short(b.sum) + "</text>" +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + b.label + " дн.</text>";
    });
    svg += "</svg>";

    // по причинам
    const byReason = {};
    views.forEach(function (v) { byReason[v.reason.code] = (byReason[v.reason.code] || 0) + v.bal; });
    const maxR = Math.max.apply(null, Object.values(byReason).concat([1]));
    const reasonBars = Object.keys(byReason).sort(function (x, y) { return byReason[y] - byReason[x]; }).map(function (c) {
      return '<div class="hbar tone-' + E.REASONS[c].tone + '"><span>' + E.REASONS[c].label + '</span><span class="track"><i style="width:' + (byReason[c] / maxR * 100) + '%"></i></span><span class="num">' + short(byReason[c]) + "</span></div>";
    }).join("");

    // возвраты по дням (накопительно)
    const days = Math.max(state.day, 7);
    let cum = 0; const pts = [];
    for (let d = 0; d <= days; d++) {
      cum += state.recoveredLog.filter(function (r) { return r.day === d; }).reduce(function (s, r) { return s + r.amount; }, 0);
      pts.push(cum);
    }
    const maxC = Math.max(cum, 1);
    const LW = 460, LH = 200, lp = 12, lb = 24, lt = 24;
    const xs = function (d) { return lp + (LW - lp * 2) * d / days; };
    const ys = function (v) { return LH - lb - (LH - lb - lt) * v / maxC; };
    const visible = pts.slice(0, state.day + 1);
    const line = visible.map(function (v, d) { return (d ? "L" : "M") + xs(d).toFixed(1) + " " + ys(v).toFixed(1); }).join(" ");
    let lsvg = '<svg viewBox="0 0 ' + LW + " " + LH + '" role="img" aria-label="Возвращено накопительно">';
    [0.5, 1].forEach(function (f) { lsvg += '<line class="grid" x1="0" x2="' + LW + '" y1="' + ys(maxC * f) + '" y2="' + ys(maxC * f) + '"/>'; });
    lsvg += '<line class="grid" x1="0" x2="' + LW + '" y1="' + ys(0) + '" y2="' + ys(0) + '"/>';
    if (visible.length > 1) lsvg += '<path d="' + line + " L" + xs(state.day) + " " + ys(0) + " L" + xs(0) + " " + ys(0) + ' Z" fill="var(--accent)" opacity=".12"/><path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>';
    lsvg += '<circle cx="' + xs(state.day) + '" cy="' + ys(cum) + '" r="4.5" fill="var(--accent)"/>' +
      '<text class="v" x="' + Math.min(xs(state.day) + 8, LW - 90) + '" y="' + (ys(cum) - 8) + '">' + short(cum) + "</text>" +
      '<text x="' + lp + '" y="' + (LH - 6) + '">' + fmtDay(0) + "</text>" +
      '<text x="' + (LW - lp) + '" y="' + (LH - 6) + '" text-anchor="end">' + fmtDay(days) + "</text></svg>";

    // эффективность по причинам
    const recByReason = {};
    state.recoveredLog.forEach(function (r) { recByReason[r.reason] = (recByReason[r.reason] || 0) + r.amount; });

    return '<div class="grid2">' +
      '<div class="panel chart"><h3>Задолженность по сроку просрочки</h3>' + svg + "</div>" +
      '<div class="panel"><h3>Задолженность по причинам</h3><div class="hbars">' + reasonBars + "</div></div>" +
      '<div class="panel chart"><h3>Возвращено накопительно</h3>' + lsvg + (state.day === 0 ? '<p class="note">Нажмите «Следующий день», чтобы увидеть, как сценарии возвращают деньги.</p>' : "") + "</div>" +
      '<div class="panel"><h3>Что сработало</h3>' + (Object.keys(recByReason).length ? '<div class="hbars">' + Object.keys(recByReason).map(function (c) {
        const m = Math.max.apply(null, Object.values(recByReason));
        return '<div class="hbar tone-' + E.REASONS[c].tone + '"><span>' + E.REASONS[c].label + '</span><span class="track"><i style="width:' + (recByReason[c] / m * 100) + '%"></i></span><span class="num">' + short(recByReason[c]) + "</span></div>";
      }).join("") + "</div>" : '<p class="note">Пока нет поступлений. Здесь появится разбивка возвращённых денег по причине неоплаты.</p>') + "</div></div>";
  }

  function playbooksView() {
    return '<p class="note">Сценарий выбирается по причине неоплаты. Каждый шаг выполняется автоматически в свой день; звонки превращаются в задачи для менеджера. Сценарий останавливается при оплате или открытом споре.</p><div class="pb">' +
      Object.keys(E.PLAYBOOKS).map(function (c) {
        return '<div class="panel"><h3>' + reasonPill(c) + "</h3><ul class=\"steps\">" + E.PLAYBOOKS[c].map(function (st) {
          return '<li><span class="d">день ' + st[0] + "</span>" + esc(E.ACTIONS[st[1]].label) + "</li>";
        }).join("") + "</ul></div>";
      }).join("") + "</div>";
  }

  function drawer() {
    const a = acc(ui.open);
    if (!a) return "";
    const v = view(a), s = a.signals;
    if (!ui.draft || ui.draft.id !== a.id || ui.draft.code !== v.reco.code) {
      ui.draft = Object.assign({ id: a.id, code: v.reco.code }, draftFor(v, v.reco.code));
    }
    const hasMsg = ["email"].indexOf(v.reco.channel) >= 0 || v.reco.code === "call";
    let h = '<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(a.name) + '">' +
      '<header><div style="flex:1;min-width:0"><h2>' + esc(a.name) + '</h2><div class="meta"><span>' + esc(a.industry) + " · " + esc(a.plan) + " · MRR " + short(a.mrr) + "</span><span>Ответственный: " + esc(a.owner) + "</span>" +
      "<span>" + esc(a.contact.name) + ", " + esc(a.contact.email) + ", " + esc(a.contact.phone) + "</span></div></div>" +
      '<button class="btn ghost" data-act="close" aria-label="Закрыть">✕</button></header><div class="body">';
    if (!v.bal) {
      h += '<div class="paid-banner">Задолженность погашена. Клиент выйдет из очереди.</div>';
    } else {
      h += '<div class="facts"><div class="fact"><div class="label">Просрочено</div><div class="value">' + money(v.bal) + '</div></div>' +
        '<div class="fact"><div class="label">Дней просрочки</div><div class="value">' + v.days + '</div></div>' +
        '<div class="fact sev-' + v.tier.key + '"><div class="label">Приоритет</div><div class="value"><span class="sevdot"></span> ' + v.score + " · " + v.tier.label + "</div></div></div>";

      h += '<section class="panel reco"><h3>Рекомендованное действие <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">' + esc(CH[v.reco.channel] || "") + '</span></h3>' +
        '<div class="reco-title">' + esc(v.reco.label) + '</div><div class="muted">' + esc(v.reco.why) + "</div>";
      if (hasMsg) {
        h += '<div class="field"><label for="d-subj">' + (v.reco.code === "call" ? "Тема звонка" : "Тема письма") + '</label><input id="d-subj" value="' + esc(ui.draft.subject) + '"></div>' +
          '<div class="field"><label for="d-body">' + (v.reco.code === "call" ? "Скрипт" : "Текст") + '</label><textarea id="d-body">' + esc(ui.draft.body) + "</textarea></div>";
      }
      h += '<div class="row-actions"><button class="btn primary" data-act="exec">' + (v.reco.code === "call" ? "Отметить звонок" : v.reco.channel === "email" ? "Отправить" : v.reco.channel === "none" ? "Понятно" : "Выполнить") + "</button>" +
        '<select id="alt" aria-label="Другое действие"><option value="">Другое действие…</option>' + Object.keys(E.ACTIONS).filter(function (c) { return c !== v.reco.code && c !== "wait_promise"; }).map(function (c) { return '<option value="' + c + '">' + E.ACTIONS[c].label + "</option>"; }).join("") + "</select></div>" +
        (s.bounced && hasMsg && v.reco.code !== "call" ? '<p class="note">Адрес клиента не принимает письма; сообщение будет записано как недоставленное.</p>' : "") + "</section>";

      // причина
      h += '<section class="panel"><h3>Причина неоплаты ' + reasonPill(v.reason.code) + '</h3><ul class="evidence">' + v.reason.evidence.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>" +
        '<div class="inline"><span class="note">Уверенность ' + Math.round(v.reason.confidence * 100) + '%.</span><label class="note" for="ovr">Исправить причину:</label><select id="ovr"><option value="">авто</option>' +
        Object.keys(E.REASONS).map(function (c) { return '<option value="' + c + '"' + (a.reasonOverride === c ? " selected" : "") + ">" + E.REASONS[c].label + "</option>"; }).join("") + "</select>" +
        (s.dispute ? '<button class="btn small" data-act="resolve">Спор урегулирован</button>' : "") + "</div></section>";

      // автоматизация
      const au = a.automation;
      h += '<section class="panel"><h3>Автосценарий ' + (au && !au.stopped ? '<span class="auto">● активен</span>' : "") + "</h3>";
      if (au) {
        h += '<ul class="steps">' + E.PLAYBOOKS[au.playbook].map(function (st, i) {
          const done = au.done.indexOf(i) >= 0;
          return '<li><span class="d">' + fmtDay(au.start + st[0]) + '</span><span class="' + (done ? "done" : "") + '">' + esc(E.ACTIONS[st[1]].label) + "</span>" + (done ? '<span class="tag auto">выполнено</span>' : "") + "</li>";
        }).join("") + "</ul>" + (au.stopped ? '<p class="note">Остановлен: ' + esc(au.stopped) + '</p><div><button class="btn small" data-act="enroll">Запустить заново</button></div>' : '<div><button class="btn small" data-act="stop">Остановить</button></div>');
      } else {
        h += '<p class="note">Сценарий для причины «' + E.REASONS[v.reason.code].label + "»: " + E.PLAYBOOKS[v.reason.code].map(function (st) { return "день " + st[0] + ": " + E.ACTIONS[st[1]].label.toLowerCase(); }).join("; ") + '.</p><div><button class="btn" data-act="enroll">Запустить автосценарий</button></div>';
      }
      h += "</section>";

      // обещание и оплата
      h += '<section class="panel"><h3>Обещание и оплата</h3>' +
        (s.promise ? '<div>Обещание оплатить до <b>' + fmtDay(s.promise.day) + "</b> · " + { active: '<span class="pill tone-teal">ожидаем</span>', broken: '<span class="pill tone-red">нарушено</span>', kept: '<span class="pill tone-green">выполнено</span>' }[v.promise] + "</div>" : "") +
        '<div class="inline"><label class="note" for="pdays">Клиент обещал оплатить через</label><select id="pdays">' + [1, 3, 5, 7, 14].map(function (d) { return '<option value="' + d + '">' + d + " дн.</option>"; }).join("") + '</select><button class="btn small" data-act="promise">Записать обещание</button></div>' +
        '<div class="inline"><label class="note" for="pay">Поступила оплата, ' + CUR + '</label><input id="pay" class="num" inputmode="numeric" value="' + v.bal + '" style="width:140px"><button class="btn small" data-act="pay">Записать оплату</button></div></section>';
    }

    // счета
    h += '<section class="panel"><h3>Счета</h3><div style="overflow-x:auto"><table class="mini"><thead><tr><th>Счёт</th><th>Срок</th><th class="r">Сумма</th><th class="r">Остаток</th></tr></thead><tbody>' +
      a.invoices.slice().reverse().map(function (i) {
        const left = i.amount - i.paid, late = left > 0 && i.due < state.day;
        return "<tr><td class=\"num\">" + i.number + "</td><td>" + fmtDay(i.due) + (late ? ' <span class="overdue-t" style="font-size:12px">+' + (state.day - i.due) + " дн.</span>" : "") + '</td><td class="r num">' + money(i.amount) + '</td><td class="r num">' + (left ? money(left) : '<span class="muted">оплачен</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";

    // лента
    const tl = state.comms.filter(function (c) { return c.accountId === a.id; }).sort(function (x, y) { return y.day - x.day; });
    h += '<section class="panel"><h3>История</h3>' + (tl.length ? '<ul class="timeline">' + tl.map(function (c) {
      return '<li><span class="when">' + fmtDay(c.day) + '</span><div class="what"><b>' + esc(c.subject) + "</b>" + (c.auto ? '<span class="tag auto">авто</span>' : "") + '<span class="tag">' + (CH[c.channel] || "") + " · " + esc(c.status) + "</span>" + (c.body ? "<p>" + esc(c.body) + "</p>" : "") + "</div></li>";
    }).join("") + "</ul>" : '<p class="note">Контактов по этому долгу ещё не было.</p>') + "</section>";
    return h + "</div></aside>";
  }

  function render() {
    const views = overdueViews();
    const openTasks = state.tasks.filter(function (t) { return !t.done; }).length;
    const tabs = [["queue", "Очередь", views.length], ["tasks", "Задачи", openTasks], ["comms", "Коммуникации", state.comms.length], ["analytics", "Аналитика"], ["playbooks", "Сценарии"]];
    let body;
    if (ui.tab === "queue") body = queue(views);
    else if (ui.tab === "tasks") body = tasksView();
    else if (ui.tab === "comms") body = commsView();
    else if (ui.tab === "analytics") body = analytics(views);
    else body = playbooksView();
    const scroll = document.querySelector(".drawer .body");
    const st = scroll ? scroll.scrollTop : 0;
    const focusId = document.activeElement && document.activeElement.id;
    root.innerHTML =
      '<header class="top"><div class="wrap"><div class="brand"><b>Genie Map</b><span>Collections</span></div>' +
      '<div class="clock"><span class="date">Сегодня: <b>' + fmtDay(state.day) + "</b>" + (state.day ? ' <span class="muted">(день ' + state.day + " демо)</span>" : "") + "</span>" +
      '<button class="btn primary" data-act="next">Следующий день ▸</button><button class="btn ghost" data-act="reset">Сбросить демо</button></div></div></header>' +
      '<main class="wrap">' + kpis(views) +
      '<nav class="tabs" role="tablist">' + tabs.map(function (t) { return '<button class="tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + (t[2] != null ? '<span class="count">' + t[2] + "</span>" : "") + "</button>"; }).join("") + "</nav>" +
      body + "</main>" +
      '<footer class="wrap note">Демо-данные. Письма и звонки не уходят наружу: они записываются в журнал коммуникаций. Причины и действия определяются правилами по сигналам из биллинга, CRM и поддержки.</footer>' +
      (ui.open ? drawer() : "") +
      (ui.toast ? '<div class="toast" role="status">' + esc(ui.toast) + "</div>" : "");
    const ns = document.querySelector(".drawer .body");
    if (ns) ns.scrollTop = st;
    if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (f.type === "search") f.setSelectionRange(f.value.length, f.value.length); } }
  }

  let toastTimer;
  function toast(msg) {
    ui.toast = msg; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast = null; render(); }, 3800);
  }
  function commit(msg) { save(); if (msg) toast(msg); render(); }

  // ---------- События ----------
  root.addEventListener("click", function (e) {
    const t = e.target;
    if (t.matches("input[type=checkbox][data-sel]")) {
      e.stopPropagation();
      const id = t.getAttribute("data-sel");
      if (t.checked) ui.selected.add(id); else ui.selected.delete(id);
      render(); return;
    }
    if (t.matches("input[type=checkbox][data-task]")) {
      const task = state.tasks.find(function (x) { return x.id === t.getAttribute("data-task"); });
      task.done = t.checked; commit(task.done ? "Задача выполнена" : null); return;
    }
    const tab = t.closest("[data-tab]");
    if (tab) { ui.tab = tab.getAttribute("data-tab"); render(); return; }
    const chip = t.closest("[data-reason]");
    if (chip) { const c = chip.getAttribute("data-reason"); if (ui.reasons.has(c)) ui.reasons.delete(c); else ui.reasons.add(c); render(); return; }
    const actEl = t.closest("[data-act]");
    if (actEl) { act(actEl.getAttribute("data-act")); return; }
    const open = t.closest("[data-open]");
    if (open) { ui.open = open.getAttribute("data-open"); ui.draft = null; render(); }
  });
  root.addEventListener("input", function (e) {
    const t = e.target;
    if (t.id === "q") { ui.q = t.value; render(); }
    if (t.id === "d-subj" && ui.draft) ui.draft.subject = t.value;
    if (t.id === "d-body" && ui.draft) ui.draft.body = t.value;
  });
  root.addEventListener("change", function (e) {
    const t = e.target;
    if (t.id === "tierF") { ui.tierF = t.value; render(); }
    if (t.id === "ownerF") { ui.owner = t.value; render(); }
    if (t.id === "ovr") { const a = acc(ui.open); a.reasonOverride = t.value || null; ui.draft = null; commit("Причина обновлена, рекомендация пересчитана"); }
    if (t.id === "alt" && t.value) {
      const a = acc(ui.open), code = t.value;
      execute(a, code, draftFor(view(a), code), false);
      commit("Выполнено: " + E.ACTIONS[code].label.toLowerCase());
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ui.open) { ui.open = null; render(); } });

  function act(name) {
    const a = ui.open && acc(ui.open);
    switch (name) {
      case "next": nextDay(); break;
      case "reset": state = fresh(); ui.open = null; ui.selected.clear(); commit("Демо сброшено к исходным данным"); break;
      case "close": ui.open = null; render(); break;
      case "exec": {
        const v = view(a);
        execute(a, v.reco.code, { subject: ui.draft.subject, body: ui.draft.body }, false);
        ui.draft = null;
        commit(v.reco.code === "wait_promise" ? null : (v.reco.channel === "email" ? "Письмо записано в журнал как отправленное" : "Выполнено: " + v.reco.label.toLowerCase()));
        break;
      }
      case "enroll": enroll(a); commit("Автосценарий запущен, первый шаг выполнен"); break;
      case "stop": a.automation.stopped = "Остановлен вручную"; commit("Автосценарий остановлен"); break;
      case "resolve":
        a.signals.dispute = null; a.reasonOverride = null;
        logComm(a, { channel: "task", subject: "Спор урегулирован, счёт подтверждён", status: "Решено" });
        a.signals.contacted = state.day; commit("Спор закрыт. Рекомендация пересчитана"); break;
      case "promise": {
        const d = +document.getElementById("pdays").value;
        a.signals.promise = { day: state.day + d, madeOn: state.day };
        logComm(a, { channel: "call", subject: "Обещание оплатить до " + fmtDay(state.day + d), status: "Обещание оплаты" });
        addTask(a, "Проверить оплату по обещанию", d + 1);
        commit("Обещание записано, проверка поставлена на " + fmtDay(state.day + d + 1)); break;
      }
      case "pay": {
        const n = parseInt(String(document.getElementById("pay").value).replace(/\D/g, ""), 10);
        if (!n) { toast("Введите сумму оплаты цифрами"); render(); return; }
        const paid = recordPayment(a, n, "Оплата внесена вручную");
        commit("Записана оплата " + money(paid)); break;
      }
      case "bulk-auto": {
        let n = 0;
        ui.selected.forEach(function (id) { const x = acc(id); if (x && E.balance(x, state.day) && (!x.automation || x.automation.stopped)) { enroll(x); n++; } });
        ui.selected.clear(); commit("Автосценарий запущен для " + n + " клиентов"); break;
      }
      case "bulk-clear": ui.selected.clear(); render(); break;
    }
  }

  if (location.hash === "#tasks" || location.hash === "#analytics") ui.tab = location.hash.slice(1);
  render();
})();
