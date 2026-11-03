// The page's side of the app's Java bridge (HomeBridge). In a desktop browser there is no bridge, NATIVE is null and
// the page runs as a preview with sample apps.
window.NATIVE = (() => {
  const B = window.HomeBridge;
  if (!B) return null;
  const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const handlers = {};
  // Java calls window.__native(type, data) when something changes: 'now', 'inputs', 'resume', 'home'
  window.__native = (type, data) => (handlers[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  // the app art, by the packages each app ships under on Android TV
  const ART = {
    'com.netflix.ninja': 'Netflix', 'com.amazon.amazonvideo.livingroom': 'Prime Video', 'com.wbd.stream': 'HBO Max',
    'com.hbo.hbonow': 'HBO Max', 'com.disney.disneyplus': 'Disney+', 'com.google.android.youtube.tv': 'YouTube',
    'com.hulu.livingroomplus': 'Hulu', 'com.peacocktv.peacockandroid': 'Peacock', 'com.crunchyroll.crunchyroid': 'Crunchyroll',
    'com.spotify.tv.android': 'Spotify', 'com.valvesoftware.steamlink': 'Steam Link', 'com.android.vending': 'Play Store',
    'com.mediatek.wwtv.mediaplayer': 'Media Player', 'com.apple.atve.androidtv.appletv': 'Apple TV',
    'com.apple.atve.sony.appletv': 'Apple TV', 'org.xbmc.kodi': 'Kodi', 'com.cbs.ott': 'Paramount+', 'com.cbs.ca': 'Paramount+',
    'com.plexapp.android': 'Plex', 'tv.pluto.android': 'Pluto TV', 'com.sling': 'Sling', 'com.tubitv': 'Tubi',
    'tv.twitch.android.app': 'Twitch', 'com.google.android.youtube.tvunplugged': 'YouTube TV',
    'com.google.android.youtube.tvkids': 'YouTube Kids', 'com.google.android.youtube.tvmusic': 'YouTube Music',
    'com.espn.score_center': 'ESPN', 'com.amazon.music.tv': 'Amazon Music',
    'com.discovery.discoveryplus.mobile': 'Discovery+', 'com.discovery.discoveryplus.androidtv': 'Discovery+',
    'org.jellyfin.androidtv': 'Jellyfin', 'org.videolan.vlc': 'VLC', 'com.nvidia.geforcenow': 'GeForce NOW',
    'com.microsoft.xcloud': 'Xbox', 'org.pbskids.video': 'PBS Kids', 'com.pbs.video': 'PBS',
    'com.pandora.android.atv': 'Pandora', 'com.clearchannel.iheartradio.tv': 'iHeartRadio',
    'com.esaba.downloader': 'Downloader', 'tv.emby.embyatv': 'Emby', 'com.dazn': 'DAZN', 'com.philo.philo.google': 'Philo',
    'com.cybercat.adbappcontrol.tv': 'ADB AppControl',
    'com.neilturner.aerialviews': 'Aerial Views',
    'tv.corebuilds.iconpack': 'Core Builds',
    'com.alphainventor.filemanager': 'CX File Explorer',
    'com.roysolberg.android.developertools': 'Developer Tools',
    'com.finalwire.aida64': 'AIDA64',
    'com.nordvpn.android': 'NordVPN',
    'com.nuvio.tv.test': 'Nuvio TV',
    'com.spocky.projengmenu': 'Projectivy Launcher',
    'dev.projectivy.blueprint.app': 'Projectivy Blueprint',
    'com.emanuelef.remote_capture': 'PCAPdroid',
    'com.yablio.sendfilestotv': 'Send Files to TV',
    'org.smarttube.stable': 'SmartTube Next',
    'com.tabdeveloper.tvoverlay': 'TvOverlay',
    'ar.tvplayer.tv': 'TiviMate',
    'dev.vodik7.tvquickactions': 'TV Quick Actions',
    'com.phlox.tvwebbrowser': 'TV Bro',
    'net.gtvbox.videoplayer': 'Vimu Player',
    'com.realtek.airplay2': 'AirPlay', 'com.android.tv.settings': 'Settings',
  };
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9+]/g, '');
  // the tile art the app carries; an app whose art isn't there gets the badge made from its own icon
  const ARTFILES = new Set(json(B.artFiles(), []));

  return {
    on(type, fn) { (handlers[type] ||= []).push(fn); },
    device: () => json(B.device(), {}),
    appVersion: () => json(B.appVersion(), {}),
    network: () => json(B.network(), { type: 'none' }),
    apps: () => json(B.apps(), []),
    // the design's name for an installed app: by package first, then by a matching label
    artName(pkg, label, names) {
      if (ART[pkg]) return ART[pkg];
      const n = norm(label);
      return names.find(x => norm(x) === n) || null;
    },
    hasArt: file => ARTFILES.has(file + '.webp'),
    launch: pkg => B.launch(pkg),
    recents: () => json(B.recents(), {}),
    appInfo: pkg => json(B.appInfo(pkg), {}),
    uninstall: pkg => B.uninstall(pkg),
    nowPlaying: () => json(B.nowPlaying(), { access: false }),
    playPause: () => B.playPause(),
    skip: next => B.skip(next),
    listenerCommand: () => B.listenerCommand(),
    inputs: () => json(B.inputs(), []),
    switchInput: id => B.switchInput(id),
    openLiveTv: () => B.openLiveTv(),
    openSettings: which => B.openSettings(which),
  };
})();
