// Ссылки на страницы настроек веб-интерфейса Marantz NR1604 — структура как в меню самого ресивера (Setup Menu).
// Только фреймсеты f_*.asp: на d_*.asp форма уходит в несуществующий фрейм. Все пути сверены с обходом ~/receiver-crawl/
// (SETUP__<РАЗДЕЛ>__<СТРАНИЦА>__f_*.asp) и проверены GET-ом. Адрес ресивера здесь не хранится:
// HomeLink service='marantz' берёт его из реестра ссылок сервера (config.marantz.host).
//
// Не добавлять: Firmware, Setup Lock, Set Defaults/Reset/Restore. Не включены также «Subwoofer Level» и «Front Speaker»
// (в меню ресивера серые, без ссылки), «Picture Adjust» и «Output Settings» (в меню этой модели их нет) и Network → Settings
// (смена IP-адреса ресивера может оборвать связь с панелью). M-DAX лежит по адресу RESTORER (так называется в самом ресивере).
export type ReceiverGroupId = 'audio' | 'video' | 'inputs' | 'speakers' | 'network' | 'general'
export type ReceiverLink = { group: ReceiverGroupId; key: string; ru: string; en: string; path: string; hint: string }
export type ReceiverGroup = { id: ReceiverGroupId; ru: string; en: string }

export const RECEIVER_ROOT_PATH = '/'

export const RECEIVER_GROUPS: ReceiverGroup[] = [
  { id: 'audio', ru: 'Звук', en: 'Audio' },
  { id: 'video', ru: 'Видео', en: 'Video' },
  { id: 'inputs', ru: 'Входы', en: 'Inputs' },
  { id: 'speakers', ru: 'Колонки', en: 'Speakers' },
  { id: 'network', ru: 'Сеть', en: 'Network' },
  { id: 'general', ru: 'Общее', en: 'General' },
]

export const RECEIVER_LINKS: ReceiverLink[] = [
  // ---- Звук ----
  { group: 'audio', key: 'dialog', ru: 'Уровень диалогов', en: 'Dialog Level', path: '/SETUP/AUDIO/DIALOGLEVEL/f_audio.asp', hint: 'Уровень диалогов от −12 до +12 дБ (сейчас −3,5).' },
  { group: 'audio', key: 'surround', ru: 'Параметры окружающего звука', en: 'Surround Parameter', path: '/SETUP/AUDIO/SURROUNDPARAMETER/f_audio.asp', hint: 'Home Theater EQ, Loudness Management, Dynamic Compression, Low Frequency Effect, Center Image. В режиме Stereo пункты недоступны («Not available»).' },
  { group: 'audio', key: 'tone', ru: 'Тембр', en: 'Tone', path: '/SETUP/AUDIO/TONE/f_audio.asp', hint: 'Тембр и Tone Defeat (обход регуляторов тембра).' },
  { group: 'audio', key: 'mdax', ru: 'M-DAX, улучшение сжатого звука', en: 'M-DAX', path: '/SETUP/AUDIO/RESTORER/f_audio.asp', hint: 'M-DAX: восстановление качества сжатого звука (MP3, потоковое). Страница лежит по адресу RESTORER.' },
  { group: 'audio', key: 'delay', ru: 'Задержка звука', en: 'Audio Delay', path: '/SETUP/AUDIO/AUDIODELAY/f_audio.asp', hint: 'Задержка звука в миллисекундах, для синхронизации с изображением.' },
  { group: 'audio', key: 'volume', ru: 'Громкость', en: 'Volume', path: '/SETUP/AUDIO/VOLUME/f_audio.asp', hint: 'Громкость: шкала, предел Limit, громкость при включении, уровень Mute. У ресивера свой Limit (сейчас Off), он не зависит от потолка громкости панели.' },
  { group: 'audio', key: 'audyssey', ru: 'Audyssey: коррекция акустики', en: 'Audyssey', path: '/SETUP/AUDIO/AUDYSSEY/f_audio.asp', hint: 'Audyssey: MultEQ, Dynamic EQ, Dynamic Volume, Reference Level Offset.' },
  // ---- Видео ----
  { group: 'video', key: 'hdmi', ru: 'Настройка HDMI', en: 'HDMI Setup', path: '/SETUP/VIDEO/HDMISETUP/f_video.asp', hint: 'HDMI: Auto Lip Sync, HDMI Control, источник для Pass Through.' },
  { group: 'video', key: 'osd', ru: 'Экранное меню', en: 'On Screen Display', path: '/SETUP/VIDEO/ONSCREENDISPLAY/f_video.asp', hint: 'Экранное меню: положение индикатора громкости (Volume), Info, Now Playing.' },
  { group: 'video', key: 'tvformat', ru: 'Формат ТВ', en: 'TV Format', path: '/SETUP/VIDEO/TVFORMAT/f_video.asp', hint: 'Видеостандарт NTSC или PAL. При смене сетевая функция ресивера перезапускается.' },
  // ---- Входы ----
  { group: 'inputs', key: 'assign', ru: 'Назначение входов', en: 'Input Assign', path: '/SETUP/INPUTS/INPUTASSIGN/f_InputAssign.asp', hint: 'Какой цифровой и HDMI-разъём относится к какому источнику. На странице есть кнопка «Set Defaults» — не нажимайте.' },
  { group: 'inputs', key: 'rename', ru: 'Переименование источников', en: 'Source Rename', path: '/SETUP/INPUTS/SOURCERENAME/f_Rename.asp', hint: 'Имена источников (GAME, TV AUDIO и т. д.): они же показываются в пульте панели. На странице есть кнопка «Set Defaults» — не нажимайте.' },
  { group: 'inputs', key: 'hide', ru: 'Скрыть источники', en: 'Hide Sources', path: '/SETUP/INPUTS/HIDESOURCES/f_Delete.asp', hint: 'Какие источники показывать в списке входов ресивера (USE / DEL). Скрытые входы пропадают и с кнопок пульта в панели.' },
  { group: 'inputs', key: 'level', ru: 'Уровень источников', en: 'Source Level', path: '/SETUP/INPUTS/SOURCELEVEL/f_inputsetup.asp', hint: 'Выравнивание громкости источников, в дБ.' },
  { group: 'inputs', key: 'select', ru: 'Выбор входа', en: 'Input Select', path: '/SETUP/INPUTS/INPUTSELECT/f_inputsetup.asp', hint: 'Input Mode (например ARC) и Decode Mode для выбранного источника.' },
  // ---- Колонки ----
  { group: 'speakers', key: 'amp', ru: 'Назначение усилителей', en: 'Amp Assign', path: '/SETUP/SPEAKERS/AMPASSIGN/f_speakersetup.asp', hint: 'Assign Mode: как используются усилители (Surround Back, ZONE2, Bi-Amp, Front B, Front Height).' },
  { group: 'speakers', key: 'config', ru: 'Конфигурация колонок', en: 'Speaker Config.', path: '/SETUP/SPEAKERS/SPEAKERCONFIG/f_speakersetup.asp', hint: 'Какие колонки подключены и их размер (Small / Large).' },
  { group: 'speakers', key: 'distances', ru: 'Дистанции до колонок', en: 'Distances', path: '/SETUP/SPEAKERS/DISTANCES/f_speakersetup.asp', hint: 'Расстояния от слушателя до каждой колонки.' },
  { group: 'speakers', key: 'crossovers', ru: 'Кроссоверы', en: 'Crossovers', path: '/SETUP/SPEAKERS/CROSSOVERS/f_speakersetup.asp', hint: 'Частоты раздела между колонками и сабвуфером.' },
  { group: 'speakers', key: 'bass', ru: 'Настройка баса', en: 'Bass', path: '/SETUP/SPEAKERS/BASS/f_speakersetup.asp', hint: 'Subwoofer Mode и фильтр LPF for LFE, 80–250 Гц (сейчас 80 Гц).' },
  // ---- Сеть ----
  { group: 'network', key: 'ipcontrol', ru: 'IP-управление', en: 'IP Control', path: '/SETUP/NETWORK/IPCONTROL/f_network.asp', hint: 'Network Standby: ресивер остаётся доступным по сети в режиме ожидания. Нужно, чтобы панель могла его включить.' },
  { group: 'network', key: 'friendly', ru: 'Имя в сети', en: 'Friendly Name', path: '/SETUP/NETWORK/FRIENDLYNAME/f_network.asp', hint: 'Имя ресивера в сети (в приложениях и DLNA). На странице есть кнопка «Def» — не нажимайте.' },
  { group: 'network', key: 'account', ru: 'Учётная запись', en: 'User Account', path: '/SETUP/NETWORK/USERACCOUNT/f_account.asp', hint: 'Учётная запись для сетевых сервисов (страница открывается через переадресацию).' },
  // ---- Общее ----
  { group: 'general', key: 'language', ru: 'Язык', en: 'Language', path: '/SETUP/GENERAL/LANGUAGE/f_general.asp', hint: 'Язык экранного меню.' },
  { group: 'general', key: 'zone2', ru: 'Настройка Зоны 2', en: 'ZONE2 Setup', path: '/SETUP/GENERAL/ZONE2SETUP/f_general.asp', hint: 'Вторая зона: уровни левого и правого каналов, Volume Level, Volume Limit, громкость при включении.' },
  { group: 'general', key: 'zonerename', ru: 'Названия зон', en: 'Zone Rename', path: '/SETUP/GENERAL/ZONERENAME/f_general.asp', hint: 'Имена зон (сейчас Room, Kitchen). На странице есть кнопка «Def» — не нажимайте.' },
  { group: 'general', key: 'trigger', ru: 'Триггерный выход', en: 'Trigger Out', path: '/SETUP/GENERAL/TRIGGEROUT/f_general.asp', hint: 'Триггерный выход 12 В для внешней техники: отдельно для главной зоны, Zone 2 и каждого входа.' },
  { group: 'general', key: 'autostandby', ru: 'Автоматический режим ожидания', en: 'Auto Standby', path: '/SETUP/GENERAL/AUTOSTANDBY/f_general.asp', hint: 'Автоматическое выключение ресивера при отсутствии сигнала или управления.' },
  { group: 'general', key: 'display', ru: 'Дисплей на передней панели', en: 'Front Display', path: '/SETUP/GENERAL/FRONTDISPLAY/f_general.asp', hint: 'Яркость дисплея (Dimmer).' },
  { group: 'general', key: 'information', ru: 'Информация о сигнале и формате', en: 'Information', path: '/SETUP/GENERAL/INFORMATION/f_information.asp', hint: 'Только просмотр: Sound Mode, Input Signal, Format, Fs, сведения о видеосигнале HDMI.' },
  { group: 'general', key: 'usage', ru: 'Данные об использовании', en: 'Usage Data', path: '/SETUP/GENERAL/USAGEDATA/f_general.asp', hint: 'Отправлять данные об использовании производителю (Yes / No).' },
]

/** Без регистра и без различия ё/е */
export const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()

/** Фильтр по русскому и английскому названию (и ключу); пустой запрос — все ссылки */
export function searchLinks(links: ReceiverLink[], query: string): ReceiverLink[] {
  const q = normalize(query)
  if (!q) return links
  return links.filter((l) => normalize(l.ru).includes(q) || normalize(l.en).includes(q) || l.key.includes(q))
}

/** Разбиение текста на части для подсветки совпадения (нормализация не меняет длину строки: ё→е, регистр) */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const q = normalize(query)
  const i = q ? normalize(text).indexOf(q) : -1
  if (i < 0) return [{ text, match: false }]
  return [
    ...(i > 0 ? [{ text: text.slice(0, i), match: false }] : []),
    { text: text.slice(i, i + q.length), match: true },
    ...(i + q.length < text.length ? [{ text: text.slice(i + q.length), match: false }] : []),
  ]
}
