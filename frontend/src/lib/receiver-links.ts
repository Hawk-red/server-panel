// Страницы настроек веб-интерфейса Marantz NR1604 (только фреймсеты f_*.asp: на d_*.asp форма уходит в несуществующий фрейм).
// Адрес ресивера здесь не хранится: HomeLink service='marantz' берёт его из реестра ссылок сервера (config.marantz.host).
// Не добавлять: Firmware, Set Defaults, Restore, Auto Standby, Setup Lock.
export type ReceiverLink = { label: string; path: string }

export const RECEIVER_LINK_GROUPS: { title: string; links: ReceiverLink[] }[] =
  [
    {
      title: 'Звук',
      links: [
        {
          label:
            'Audyssey: MultEQ, Dynamic EQ, Dynamic Volume, Reference Level',
          path: '/SETUP/AUDIO/AUDYSSEY/f_audio.asp',
        },
        { label: 'Громкость', path: '/SETUP/AUDIO/VOLUME/f_audio.asp' },
        { label: 'Тембр (Tone)', path: '/SETUP/AUDIO/TONE/f_audio.asp' },
        {
          label: 'Уровень диалогов',
          path: '/SETUP/AUDIO/DIALOGLEVEL/f_audio.asp',
        },
        {
          label: 'Задержка звука',
          path: '/SETUP/AUDIO/AUDIODELAY/f_audio.asp',
        },
      ],
    },
    {
      title: 'Колонки и видео',
      links: [
        {
          label: 'Конфигурация колонок',
          path: '/SETUP/SPEAKERS/SPEAKERCONFIG/f_speakersetup.asp',
        },
        { label: 'HDMI', path: '/SETUP/VIDEO/HDMISETUP/f_video.asp' },
      ],
    },
    {
      title: 'Сеть и зоны',
      links: [
        {
          label: 'Сеть (IP-управление)',
          path: '/SETUP/NETWORK/IPCONTROL/f_network.asp',
        },
        {
          label: 'Имя в сети',
          path: '/SETUP/NETWORK/FRIENDLYNAME/f_network.asp',
        },
        { label: 'Зона 2', path: '/SETUP/GENERAL/ZONE2SETUP/f_general.asp' },
      ],
    },
  ]
