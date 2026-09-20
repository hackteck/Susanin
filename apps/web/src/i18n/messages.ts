export type Locale = 'ru' | 'ka' | 'en'

/** Georgian is the city's language, Russian is what most visitors read. */
export const locales: Locale[] = ['ru', 'ka', 'en']

export const localeNames: Record<Locale, string> = {
  ru: 'Русский',
  ka: 'ქართული',
  en: 'English',
}

/** Two letters for the switcher — the language in its own script. */
export const localeShort: Record<Locale, string> = {
  ru: 'RU',
  ka: 'ქა',
  en: 'EN',
}

// Every string the UI says in its own voice. Names that come from the feed are
// localised separately — see `useLocale().name`.
export const messages = {
  appName: { ru: 'Сусанин', ka: 'სუსანინი', en: 'Susanin' },
  tagline: {
    ru: 'Автобусы Батуми в реальном времени',
    ka: 'ბათუმის ავტობუსები რეალურ დროში',
    en: 'Batumi buses, live',
  },

  map: { ru: 'Карта', ka: 'რუკა', en: 'Map' },
  routes: { ru: 'Маршруты', ka: 'მარშრუტები', en: 'Routes' },
  routeLabel: { ru: 'Маршрут', ka: 'მარშრუტი', en: 'Route' },
  stops: { ru: 'Остановки', ka: 'გაჩერებები', en: 'Stops' },
  about: { ru: 'О проекте', ka: 'პროექტის შესახებ', en: 'About' },

  allRoutes: { ru: 'Все маршруты', ka: 'ყველა მარშრუტი', en: 'All routes' },
  clearSelection: { ru: 'Сбросить', ka: 'გასუფთავება', en: 'Clear' },
  // One line or several: a count drawn from the whole fleet is not «на линии».
  // English needs no line noun to say it, so both forms are the same word.
  onTheLine: { ru: 'на линии', ka: 'ხაზზე', en: 'running' },
  onTheLines: { ru: 'на линиях', ka: 'ხაზებზე', en: 'running' },
  noBuses: {
    ru: 'Сейчас на маршруте нет автобусов',
    ka: 'ამ მარშრუტზე ავტობუსი არ ჩანს',
    en: 'No buses on this route right now',
  },

  // Abstract direction labels are a last resort: a destination is what a rider
  // actually navigates by, so the UI says "→ terminal" wherever it has one.
  outbound: { ru: 'Прямой', ka: 'პირდაპირ', en: 'Outbound' },
  inbound: { ru: 'Обратный', ka: 'უკან', en: 'Inbound' },

  scheduled: { ru: 'По расписанию', ka: 'განრიგით', en: 'Scheduled' },
  live: { ru: 'Сейчас', ka: 'ცოცხალი', en: 'Live' },
  estimateNote: {
    ru: 'Время рассчитано по текущему положению автобуса — это не официальный прогноз.',
    ka: 'დროის შეფასება გამოთვლილია ავტობუსის ამჟამინდელი მდებარეობიდან — ეს არ არის ოფიციალური პროგნოზი.',
    en: 'Times are computed from each bus’s current position — they are not official predictions.',
  },
  minutesShort: { ru: 'мин', ka: 'წთ', en: 'min' },
  // What a countdown says once it runs out. Not "0 min" — the bus is at the kerb.
  approaching: { ru: 'Подъезжает', ka: 'მოდის', en: 'Due' },
  firstBusTomorrow: { ru: 'Первый завтра', ka: 'პირველი ხვალ', en: 'First tomorrow' },
  noService: { ru: 'Сегодня больше нет', ka: 'დღეს აღარ არის', en: 'No more today' },

  // The several different nothings. Rendering one string for all of them tells
  // a rider the service has ended when the truth may be that we cannot see it.
  noRoutesHere: {
    ru: 'Через эту остановку маршруты не проходят',
    ka: 'აქ მარშრუტები არ გადის',
    en: 'No routes serve this stop',
  },
  noTimetable: {
    ru: 'Расписание не опубликовано — только живое отслеживание',
    ka: 'განრიგი არ არის გამოქვეყნებული — მხოლოდ ცოცხალი თვალყური',
    en: 'No published timetable — live tracking only',
  },
  liveLabel: { ru: 'в реальном времени', ka: 'რეალურ დროში', en: 'live' },
  // The fifth kind of nothing: not "no buses", but "we cannot see them".
  // Offline, this is the difference between a timetable and a wrong answer.
  liveUnavailable: {
    ru: 'Живые данные недоступны — показано расписание',
    ka: 'ცოცხალი მონაცემები მიუწვდომელია — ნაჩვენებია განრიგი',
    en: 'Live data unavailable — showing the timetable',
  },
  // The same fact for the header and the route page, which have no timetable to
  // promise and no room to promise it in.
  feedUnavailable: { ru: 'Нет живых данных', ka: 'ცოცხალი მონაცემები არ არის', en: 'No live data' },

  noResults: { ru: 'Ничего не найдено', ka: 'ვერაფერი მოიძებნა', en: 'Nothing found' },
  nearMe: { ru: 'Рядом', ka: 'ჩემთან ახლოს', en: 'Nearby' },
  nearbyStops: { ru: 'Остановки рядом', ka: 'ახლომდებარე გაჩერებები', en: 'Stops near you' },
  locating: { ru: 'Определяем местоположение…', ka: 'მდებარეობის დადგენა…', en: 'Locating…' },
  // Three codes, three situations, and only one of them is the reader's doing.
  // One string for all three told someone in a tunnel that they had said no.
  locationDenied: { ru: 'Доступ к местоположению запрещён', ka: 'მდებარეობაზე წვდომა აკრძალულია', en: 'Location access is blocked' },
  locationTimeout: {
    ru: 'Не удалось определить местоположение — попробуйте ещё раз',
    ka: 'მდებარეობა ვერ დადგინდა — სცადეთ ხელახლა',
    en: 'Could not get a fix — try again',
  },
  locationUnavailable: { ru: 'Местоположение недоступно', ka: 'მდებარეობა მიუწვდომელია', en: 'Location unavailable' },
  metresAway: { ru: 'м', ka: 'მ', en: 'm' },
  kilometresAway: { ru: 'км', ka: 'კმ', en: 'km' },
  walkMinutes: { ru: 'мин пешком', ka: 'წთ ფეხით', en: 'min walk' },
  noNearbyStops: {
    ru: 'Рядом остановок не нашлось',
    ka: 'ახლოს გაჩერებები არ მოიძებნა',
    en: 'No stops within walking distance',
  },
  // Said plainly, because Batumi has a river, a rail line and a port: the
  // straight line to a stop is not always a route to it. The walk time already
  // allows for the typical detour (planner/walking.ts); the distance does not.
  straightLineNote: {
    ru: 'Расстояние — по прямой; время пешком — с поправкой на улицы, но путь бывает и длиннее.',
    ka: 'მანძილი პირდაპირი ხაზითაა; სავალი დრო ქუჩებს ითვალისწინებს, თუმცა გზა შეიძლება უფრო გრძელი იყოს.',
    en: 'Distances are straight-line; walk times allow for streets, but a walk can still run longer.',
  },

  stopNumber: { ru: 'Остановка №', ka: 'გაჩერება №', en: 'Stop no.' },
  timetable: { ru: 'Расписание', ka: 'განრიგი', en: 'Timetable' },
  timetableNote: {
    ru: 'Единое расписание на все дни — источник не разделяет дни недели.',
    ka: 'ერთი განრიგი ყოველდღე — წყარო დღეებს არ ჰყოფს.',
    en: 'One timetable for every day — the source does not separate weekdays.',
  },
  everyMinutes: { ru: 'интервал', ka: 'ინტერვალი', en: 'every' },
  // Folding a timetable back up is not «Сбросить»: that word resets a filter.
  showLess: { ru: 'Свернуть', ka: 'ჩაკეცვა', en: 'Show less' },

  loading: { ru: 'Загрузка…', ka: 'იტვირთება…', en: 'Loading…' },
  loadFailed: { ru: 'Не удалось загрузить данные', ka: 'მონაცემები ვერ ჩაიტვირთა', en: 'Could not load data' },
  loadFailedDetail: {
    ru: 'Транспортная служба Батуми сейчас не отвечает. Попробуйте ещё раз через минуту.',
    ka: 'ბათუმის სატრანსპორტო სერვისი არ პასუხობს. სცადეთ ერთი წუთის შემდეგ.',
    en: 'Batumi’s transit service is not answering right now. Try again in a minute.',
  },
  retry: { ru: 'Повторить', ka: 'ხელახლა', en: 'Retry' },
  notFound: { ru: 'Страница не найдена', ka: 'გვერდი ვერ მოიძებნა', en: 'Page not found' },
  backToMap: { ru: 'Вернуться к карте', ka: 'რუკაზე დაბრუნება', en: 'Back to the map' },
  close: { ru: 'Закрыть', ka: 'დახურვა', en: 'Close' },
  showOnMap: { ru: 'На карте', ka: 'რუკაზე', en: 'Show on map' },
  routesThrough: {
    ru: 'Маршруты через остановку',
    ka: 'მარშრუტები ამ გაჩერებაზე',
    en: 'Routes through this stop',
  },

  // Seeing yourself on the map.
  centreOnMe: { ru: 'Показать, где я', ka: 'ჩემს მდებარეობაზე', en: 'Centre on me' },
  accuracyLabel: { ru: 'Точность', ka: 'სიზუსტე', en: 'Accuracy' },
  locationStale: {
    ru: 'Местоположение могло устареть',
    ka: 'მდებარეობა შესაძლოა მოძველებული იყოს',
    en: 'Your position may be out of date',
  },
  coarseFix: {
    ru: 'Местоположение определено неточно — список может быть неверным',
    ka: 'მდებარეობა არაზუსტია — სია შეიძლება არასწორი იყოს',
    en: 'Your position is only approximate — this list may be off',
  },

  refreshLocation: { ru: 'Обновить местоположение', ka: 'მდებარეობის განახლება', en: 'Refresh location' },
  farFromBatumi: {
    ru: 'Вы сейчас далеко от Батуми — карта покажет город, а не вас',
    ka: 'ახლა ბათუმიდან შორს ხართ — რუკა ქალაქს აჩვენებს და არა თქვენ',
    en: 'You are a long way from Batumi — the map shows the city, not you',
  },

  cancel: { ru: 'Отмена', ka: 'გაუქმება', en: 'Cancel' },

  // Getting back to where the stop was chosen from.
  backToNearby: { ru: 'К остановкам рядом', ka: 'ახლომდებარე გაჩერებებზე', en: 'Back to stops near you' },

  // Planning a trip.
  planTrip: { ru: 'Как добраться', ka: 'როგორ მივიდე', en: 'Directions' },
  fromLabel: { ru: 'Откуда', ka: 'საიდან', en: 'From' },
  toLabel: { ru: 'Куда', ka: 'სადამდე', en: 'To' },
  chooseOnMap: { ru: 'Выбрать на карте', ka: 'რუკაზე არჩევა', en: 'Choose on the map' },
  chooseOnMapCancel: { ru: 'Не выбирать на карте', ka: 'რუკაზე არჩევის გაუქმება', en: 'Stop choosing on the map' },
  placesFailed: { ru: 'Не удалось загрузить адреса', ka: 'მისამართები ვერ ჩაიტვირთა', en: 'Could not load the addresses' },
  clearHistory: { ru: 'Очистить историю', ka: 'ისტორიის გასუფთავება', en: 'Clear history' },
  pointOnMap: { ru: 'Точка на карте', ka: 'წერტილი რუკაზე', en: 'Point on the map' },
  pickFromHint: {
    ru: 'Нажмите на карту, чтобы выбрать, откуда ехать',
    ka: 'შეეხეთ რუკას, რომ აირჩიოთ, საიდან წახვალთ',
    en: 'Tap the map to choose where to start',
  },
  pickToHint: {
    ru: 'Нажмите на карту, чтобы выбрать, куда ехать',
    ka: 'შეეხეთ რუკას, რომ აირჩიოთ, სად მიდიხართ',
    en: 'Tap the map to choose where to go',
  },
  swapEnds: { ru: 'Поменять местами', ka: 'ადგილების გაცვლა', en: 'Swap start and destination' },
  walk: { ru: 'Пешком', ka: 'ფეხით', en: 'Walk' },
  direct: { ru: 'Без пересадок', ka: 'გადაჯდომის გარეშე', en: 'Direct' },
  or: { ru: 'или', ka: 'ან', en: 'or' },
  // An option whose first line shows no bus coming. Said, because at night it
  // is the thing worth knowing — and said as what we see, not as "no service".
  notSeenNow: { ru: 'Сейчас не видно', ka: 'ახლა არ ჩანს', en: 'None in sight' },
  // The feed splits every route at a terminal the bus drives straight through.
  staysOn: { ru: 'Не выходите на конечной', ka: 'ბოლო გაჩერებაზე ნუ ჩამოხვალთ', en: 'Stay on through the terminus' },
  hoursShort: { ru: 'ч', ka: 'სთ', en: 'h' },
  noJourney: { ru: 'Не нашли, как добраться', ka: 'გზა ვერ მოიძებნა', en: 'No way there found' },
  noJourneyDetail: {
    ru: 'Попробуйте точку поблизости.',
    ka: 'სცადეთ ახლომდებარე წერტილი.',
    en: 'Try a point nearby.',
  },
  noStopsNearFrom: {
    ru: 'Рядом с началом пути нет остановок',
    ka: 'საწყის წერტილთან გაჩერება არ არის',
    en: 'No stops anywhere near the start',
  },
  noStopsNearTo: {
    ru: 'Рядом с пунктом назначения нет остановок',
    ka: 'დანიშნულების ადგილთან გაჩერება არ არის',
    en: 'No stops anywhere near the destination',
  },
  needLocation: {
    ru: 'Нужно ваше местоположение — разрешите доступ или выберите точку на карте',
    ka: 'საჭიროა თქვენი მდებარეობა — დაუშვით წვდომა ან აირჩიეთ წერტილი რუკაზე',
    en: 'This needs your location — allow access, or choose a point on the map',
  },
  planNote: {
    ru: 'Время в пути — оценка по расстоянию, без ожидания автобуса. Пешие отрезки — по прямой с поправкой на улицы.',
    ka: 'მგზავრობის დრო მანძილით არის შეფასებული, ავტობუსის ლოდინის გარეშე. ფეხით სავალი მონაკვეთები — პირდაპირი მანძილი ქუჩების გათვალისწინებით.',
    en: 'Travel times are estimated from distance and leave out the wait for the bus. Walks are the straight line, allowing for streets.',
  },
  nextLive: { ru: 'Ближайший сейчас', ka: 'უახლოესი ახლა', en: 'Next, live' },
  backToOptions: { ru: 'К вариантам', ka: 'ვარიანტებზე', en: 'Back to the options' },
  backToTrip: { ru: 'К маршруту', ka: 'მარშრუტზე', en: 'Back to the trip' },
  directionsFrom: { ru: 'Отсюда', ka: 'აქედან', en: 'From here' },
  directionsTo: { ru: 'Сюда', ka: 'აქამდე', en: 'To here' },
  editTrip: { ru: 'Изменить', ka: 'შეცვლა', en: 'Edit' },

  // Sharing the app.
  share: { ru: 'Поделиться', ka: 'გაზიარება', en: 'Share' },
  shareTitle: { ru: 'Поделиться Сусаниным', ka: 'სუსანინის გაზიარება', en: 'Share Susanin' },
  shareLead: {
    ru: 'Отправьте ссылку или покажите код — камера телефона откроет его сразу.',
    ka: 'გაგზავნეთ ბმული ან აჩვენეთ კოდი — ტელეფონის კამერა მას მაშინვე გახსნის.',
    en: 'Send the link, or show the code — a phone camera opens it straight away.',
  },
  shareVia: { ru: 'Отправить…', ka: 'გაგზავნა…', en: 'Send…' },
  copyLink: { ru: 'Скопировать ссылку', ka: 'ბმულის კოპირება', en: 'Copy link' },
  linkCopied: { ru: 'Ссылка скопирована', ka: 'ბმული დაკოპირდა', en: 'Link copied' },
  copyFailed: {
    ru: 'Не удалось скопировать — выделите ссылку вручную',
    ka: 'კოპირება ვერ მოხერხდა — მონიშნეთ ბმული ხელით',
    en: 'Could not copy — select the link by hand',
  },
  downloadQr: { ru: 'Скачать QR-код', ka: 'QR კოდის ჩამოტვირთვა', en: 'Download the QR code' },
  qrAlt: { ru: 'QR-код со ссылкой на Сусанин', ka: 'QR კოდი სუსანინის ბმულით', en: 'QR code linking to Susanin' },
  printHint: {
    ru: 'Код хорошо печатается — например, для остановки или стойки ресепшена.',
    ka: 'კოდი კარგად იბეჭდება — მაგალითად, გაჩერებისთვის ან სასტუმროს რეცეფციისთვის.',
    en: 'The code prints well — for a bus stop, say, or a hotel front desk.',
  },

  // The first visit. The offer is made once; the tour is four stops around the
  // furniture a reader cannot find on their own — see docs/onboarding.md.
  firstTimeHere: { ru: 'Первый раз здесь?', ka: 'პირველად ხართ აქ?', en: 'First time here?' },
  firstTimeLead: {
    ru: 'За минуту покажем, где что лежит. Или осмотритесь сами — тур можно открыть позже со страницы «О проекте».',
    ka: 'ერთ წუთში გაჩვენებთ, სად რა არის. ან თავად დაათვალიერეთ — ტური მოგვიანებით გვერდიდან „პროექტის შესახებ“ გაიხსნება.',
    en: 'A minute to show you where things are. Or look around on your own — the tour is on the About page whenever you want it.',
  },
  quickTour: { ru: 'Быстрый тур', ka: 'სწრაფი ტური', en: 'Quick tour' },
  onMyOwn: { ru: 'Осмотрюсь сам', ka: 'თავად დავათვალიერებ', en: 'I’ll look around' },

  menu: { ru: 'Меню', ka: 'მენიუ', en: 'Menu' },
  // The hint under the highlighted button on a phone. It names what is behind
  // the button, because "menu" is what the reader already failed to guess.
  menuHint: {
    ru: 'Маршруты, «как добраться» и остановки рядом — здесь',
    ka: 'მარშრუტები, „როგორ მივიდე“ და ახლომდებარე გაჩერებები — აქ',
    en: 'Routes, directions and the stops near you are in here',
  },

  tourMenuBody: {
    ru: 'Панель со всем остальным открывается этой кнопкой — и закрывается ею же.',
    ka: 'პანელი დანარჩენით ამ ღილაკით იხსნება — და იმავეთი იხურება.',
    en: 'This button opens the panel with everything else in it — and closes it again.',
  },
  tourPlannerBody: {
    ru: 'Впишите адрес или выберите точку на карте — подберём автобусы, пересадки и дорогу пешком.',
    ka: 'ჩაწერეთ მისამართი ან აირჩიეთ წერტილი რუკაზე — შევარჩევთ ავტობუსებს, გადაჯდომებს და ფეხით გზას.',
    en: 'Type an address or pick a point on the map — we find the buses, the changes and the walk.',
  },
  tourFilterBody: {
    ru: 'Нажмите номер, чтобы оставить на карте только его. Без выбора видны все маршруты.',
    ka: 'დააჭირეთ ნომერს, რომ რუკაზე მხოლოდ ის დარჩეს. არჩევის გარეშე ყველა მარშრუტი ჩანს.',
    en: 'Tap a number to leave only that line on the map. With none picked, every route shows.',
  },
  tourLocateBody: {
    ru: 'Карта перейдёт к вам, а «Рядом» покажет ближайшие остановки и время до автобуса.',
    ka: 'რუკა თქვენს მდებარეობაზე გადავა, „ჩემთან ახლოს“ კი უახლოეს გაჩერებებს და ავტობუსის დროს აჩვენებს.',
    en: 'The map jumps to where you are, and Nearby lists the closest stops with the next bus.',
  },
  tourNext: { ru: 'Далее', ka: 'შემდეგი', en: 'Next' },
  tourFinish: { ru: 'Готово', ka: 'მზადაა', en: 'Done' },
  tourSkip: { ru: 'Пропустить', ka: 'გამოტოვება', en: 'Skip' },

  toggleTheme: { ru: 'Сменить тему', ka: 'თემის შეცვლა', en: 'Toggle theme' },
  language: { ru: 'Язык', ka: 'ენა', en: 'Language' },
  followMe: { ru: 'Моё местоположение', ka: 'ჩემი მდებარეობა', en: 'My location' },
} as const satisfies Record<string, Record<Locale, string>>

export type MessageKey = keyof typeof messages

/**
 * Counted nouns, by CLDR plural category. Russian needs three forms and gets
 * them wrong in an obvious, cheap-looking way if you skip this
 * («5 автобуса»); Georgian never inflects after a numeral, and English has two.
 * `Intl.PluralRules` picks the category so none of that logic lives here.
 */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

export const counted = {
  buses: {
    ru: { one: 'автобус', few: 'автобуса', many: 'автобусов', other: 'автобуса' },
    ka: { other: 'ავტობუსი' },
    en: { one: 'bus', other: 'buses' },
  },
  routes: {
    ru: { one: 'маршрут', few: 'маршрута', many: 'маршрутов', other: 'маршрута' },
    ka: { other: 'მარშრუტი' },
    en: { one: 'route', other: 'routes' },
  },
  stops: {
    ru: { one: 'остановка', few: 'остановки', many: 'остановок', other: 'остановки' },
    ka: { other: 'გაჩერება' },
    en: { one: 'stop', other: 'stops' },
  },
  transfers: {
    ru: { one: 'пересадка', few: 'пересадки', many: 'пересадок', other: 'пересадки' },
    ka: { other: 'გადაჯდომა' },
    en: { one: 'change', other: 'changes' },
  },
} as const satisfies Record<string, Record<Locale, PluralForms>>

export type CountedKey = keyof typeof counted
