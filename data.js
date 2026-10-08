// Демо-данные: компании с регулярными счетами (подписка, ежемесячный биллинг).
// Даты хранятся как номер дня относительно «сегодня» на момент первого запуска (день 0).
(function () {
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // [компания, отрасль, контакт, тариф, MRR, срок оплаты, профиль]
  const COMPANIES = [
    ["ТОО «Каспий Логистик»", "Логистика", "Ерлан Сапаров", "Enterprise", 1840000, 30, "forgot"],
    ["АО «Нурбанк Сервис»", "Финансы", "Динара Абенова", "Enterprise", 2650000, 30, "admin"],
    ["ТОО «Алтын Агро»", "Агро", "Марат Жумабеков", "Business", 420000, 15, "hardship"],
    ["ООО «Северный Ритейл»", "Ритейл", "Ольга Крылова", "Business", 610000, 30, "payment_failed"],
    ["ТОО «Медикал Плюс»", "Медицина", "Айгерим Касымова", "Business", 380000, 15, "dispute"],
    ["ТОО «СтройМаркет KZ»", "Строительство", "Нурлан Ахметов", "Enterprise", 1290000, 30, "unresponsive"],
    ["ТОО «Smart Office»", "IT-услуги", "Алия Бекова", "Starter", 95000, 15, "forgot"],
    ["ТОО «Достык Фуд»", "HoReCa", "Тимур Ибраев", "Business", 270000, 15, "churn_risk"],
    ["АО «ЭнергоТрейд»", "Энергетика", "Виктор Ли", "Enterprise", 3120000, 45, "admin"],
    ["ТОО «Green Pharm»", "Фармацевтика", "Камила Нургалиева", "Business", 540000, 30, "payment_failed"],
    ["ТОО «Арна Девелопмент»", "Девелопмент", "Серик Омаров", "Business", 760000, 30, "hardship"],
    ["ТОО «QazEdu Online»", "Образование", "Жанна Утепова", "Starter", 120000, 15, "unresponsive"],
    ["ТОО «Атлас Моторс»", "Авто", "Руслан Мамедов", "Business", 450000, 30, "dispute"],
    ["ТОО «Бирлик Транс»", "Логистика", "Асхат Кенжебаев", "Business", 330000, 15, "forgot"],
    ["ООО «Вектор Консалт»", "Консалтинг", "Анна Петрова", "Starter", 160000, 15, "churn_risk"],
    ["ТОО «Tengri Hotels»", "HoReCa", "Мадина Серикова", "Enterprise", 980000, 30, "promise_kept"],
    ["ТОО «Шанырак Мебель»", "Производство", "Бауыржан Тулегенов", "Business", 290000, 30, "promise_broken"],
    ["ТОО «Altyn Clinic»", "Медицина", "Гульнара Ермекова", "Starter", 140000, 15, "payment_failed"],
    ["ТОО «Номад Трэвел»", "Туризм", "Ержан Касенов", "Business", 360000, 15, "unresponsive"],
    ["ТОО «ПромСнаб Восток»", "Производство", "Сергей Ким", "Enterprise", 1560000, 45, "hardship"],
    ["ТОО «Kids Planet»", "Ритейл", "Сауле Мухтарова", "Starter", 88000, 15, "forgot"],
    ["ТОО «Цифровой Документ»", "IT-услуги", "Дмитрий Орлов", "Business", 510000, 30, "admin"],
    ["ТОО «Батыс Ойл Сервис»", "Нефтегаз", "Арман Исаев", "Enterprise", 2240000, 30, "unknown"],
    ["ТОО «Ак Жол Строй»", "Строительство", "Талгат Сейткали", "Business", 470000, 30, "churn_risk"],
    ["ТОО «Мега Принт»", "Полиграфия", "Ирина Ковалёва", "Starter", 110000, 15, "dispute"],
    ["ТОО «Eurasia Fitness»", "Спорт", "Даурен Абилов", "Business", 230000, 15, "forgot"],
  ];

  const OWNERS = ["Аида К.", "Санжар М.", "Лаура Т."];

  // профиль -> сколько счетов просрочено и на сколько дней (максимум)
  const PROFILE_DAYS = {
    forgot: [6, 18], admin: [20, 50], hardship: [35, 95], payment_failed: [3, 25],
    dispute: [25, 70], unresponsive: [40, 120], churn_risk: [30, 75],
    promise_kept: [15, 30], promise_broken: [45, 70], unknown: [20, 60],
  };

  function slug(name) {
    return name.replace(/[«»"]/g, "").replace(/^(ТОО|АО|ООО)\s+/, "").toLowerCase()
      .replace(/[^a-zа-я0-9]+/g, "").slice(0, 10);
  }

  window.generateSeed = function () {
    const r = rng(20261008);
    let invNo = 4100;
    const accounts = COMPANIES.map(function (c, i) {
      const [name, industry, contact, plan, mrr, terms, profile] = c;
      const range = PROFILE_DAYS[profile];
      const maxOverdue = Math.round(range[0] + r() * (range[1] - range[0]));
      const invoices = [];
      // Ежемесячные счета за последние ~5 месяцев. Самый старый неоплаченный просрочен на maxOverdue.
      const unpaidCount = Math.max(1, Math.min(4, Math.floor(maxOverdue / 30) + 1));
      for (let k = 0; k < 6; k++) {
        // k = 0 самый старый
        const ageIndex = 5 - k; // сколько месяцев назад
        const due = -maxOverdue + (unpaidCount - 1 - ageIndex) * 30;
        const issued = due - terms;
        if (issued > 0) continue;
        const amount = Math.round(mrr * (0.95 + r() * 0.1) / 1000) * 1000;
        const isUnpaid = ageIndex < unpaidCount && due < 0;
        invoices.push({
          id: "inv" + invNo, number: "INV-" + invNo++, amount: amount, issued: issued, due: due,
          paid: isUnpaid ? 0 : amount, paidOn: isUnpaid ? null : due + Math.round(r() * 6 - 2),
        });
      }
      const onTimeBase = { forgot: 0.92, admin: 0.7, hardship: 0.45, payment_failed: 0.88, dispute: 0.75,
        unresponsive: 0.4, churn_risk: 0.6, promise_kept: 0.7, promise_broken: 0.5, unknown: 0.65 }[profile];

      const s = {
        cardFailed: profile === "payment_failed",
        cardFailReason: profile === "payment_failed" ? ["Карта просрочена", "Недостаточно средств", "Отклонено банком"][i % 3] : null,
        dispute: profile === "dispute" ? [
          "Клиент считает, что в счёт включены 12 лицензий вместо 8",
          "Оспаривают начисление за перерасход по API",
          "Просят скидку за простой сервиса 14 сентября",
        ][i % 3] : null,
        poRequired: profile === "admin",
        apNote: profile === "admin" ? ["Нужен номер заказа (PO) в счёте", "Счёт не прошёл согласование в бухгалтерии", "Требуют акт сверки перед оплатой"][i % 3] : null,
        installmentRequest: profile === "hardship" && i % 2 === 0,
        partialPayments: profile === "hardship",
        usageDrop: profile === "churn_risk" ? 45 + Math.round(r() * 30) : Math.round(r() * 15),
        openTickets: profile === "churn_risk" ? 2 + Math.floor(r() * 3) : Math.floor(r() * 2),
        bounced: profile === "unresponsive" && i % 2 === 1,
        lastReplyDaysAgo: profile === "unresponsive" ? 30 + Math.round(r() * 40) : Math.round(r() * 12),
        promise: null,
      };
      // частичная оплата для «трудностей»
      if (profile === "hardship") {
        const old = invoices.find(function (v) { return v.paid < v.amount; });
        if (old) old.paid = Math.round(old.amount * 0.3 / 1000) * 1000;
      }
      if (profile === "promise_kept") s.promise = { day: 3, amount: null, madeOn: -4 };
      if (profile === "promise_broken") s.promise = { day: -6, amount: null, madeOn: -16 };

      const handle = slug(name);
      return {
        id: "acc" + (i + 1), name: name, industry: industry, plan: plan, mrr: mrr, terms: terms,
        owner: OWNERS[i % OWNERS.length],
        contact: { name: contact, email: "billing@" + handle + ".kz", phone: "+7 7" + (10 + i) + " " + (200 + i * 7) + " " + (10 + i) + " " + (40 + i) },
        onTimeRate: Math.min(0.98, Math.max(0.2, onTimeBase + (r() - 0.5) * 0.1)),
        signals: s, invoices: invoices, profile: profile,
        reasonOverride: null, automation: null, payments: [],
      };
    });

    // Немного истории коммуникаций, чтобы лента не была пустой
    const comms = [];
    accounts.forEach(function (a, idx) {
      if (a.profile === "unresponsive" || a.profile === "promise_broken") {
        comms.push({ id: "c" + idx + "a", accountId: a.id, day: -14, channel: "email", auto: true,
          subject: "Напоминание об оплате", body: "Автоматическое напоминание о просроченном счёте.", status: "Без ответа" });
      }
      if (a.profile === "promise_kept" || a.profile === "promise_broken") {
        comms.push({ id: "c" + idx + "b", accountId: a.id, day: a.signals.promise.madeOn, channel: "call", auto: false,
          subject: "Звонок: обещание оплатить", body: a.contact.name + " пообещал(а) оплатить задолженность до " + "указанной даты.", status: "Обещание оплаты" });
      }
      if (a.profile === "dispute") {
        comms.push({ id: "c" + idx + "c", accountId: a.id, day: -9, channel: "email", auto: false, inbound: true,
          subject: "Re: Счёт к оплате", body: a.signals.dispute + ".", status: "Входящее" });
      }
    });

    const tasks = [
      { id: "t1", accountId: "acc5", due: 0, title: "Согласовать корректировку счёта с аккаунт-менеджером", done: false },
      { id: "t2", accountId: "acc17", due: -1, title: "Перезвонить: обещание оплаты нарушено", done: false },
      { id: "t3", accountId: "acc2", due: 2, title: "Получить номер PO от закупок", done: false },
    ];

    return { day: 0, accounts: accounts, comms: comms, tasks: tasks, seq: 100, recoveredLog: [] };
  };
})();
