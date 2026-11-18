export function initPWAController({ openSheet, toast }) {
  let deferredPrompt = null;
  let isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const ua = (window.navigator.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);

  const installBtn = document.getElementById('btn-install');
  const offlineBadge = document.getElementById('offline-badge');

  const updateInstallUI = () => {
    if (!installBtn) return;
    if (isInstalled) {
      installBtn.hidden = true;
      return;
    }
    installBtn.hidden = !(deferredPrompt || isIOS);
  };

  const updateOnlineUI = () => {
    if (!offlineBadge) return;
    const online = navigator.onLine !== false;
    offlineBadge.hidden = online;
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    isInstalled = true;
    deferredPrompt = null;
    updateInstallUI();
    if (toast) toast('GRIMOIRE установлено как приложение');
  });

  window.addEventListener('online', () => {
    updateOnlineUI();
    if (toast) toast('Соединение восстановлено', 1800);
  });

  window.addEventListener('offline', () => {
    updateOnlineUI();
    if (toast) toast('Автономный режим — все данные работают локально', 2400);
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        try {
          await deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          if (choice && choice.outcome === 'accepted') {
            isInstalled = true;
            deferredPrompt = null;
          }
        } catch { /* ignore */ }
        updateInstallUI();
      } else if (isIOS && openSheet) {
        openSheet(
          'Установка на iOS',
          `<div class="scroll-body">
            <p>Чтобы установить GRIMOIRE как автономное приложение на iPhone или iPad:</p>
            <div class="thesis"><i>01</i><span>Нажмите кнопку <strong>Поделиться</strong> (квадрат со стрелкой вверх) на панели Safari.</span></div>
            <div class="thesis"><i>02</i><span>Прокрутите меню вниз и выберите <strong>На экран «Домой»</strong>.</span></div>
            <div class="thesis"><i>03</i><span>После добавления приложение будет запускаться в полноэкранном режиме и работать без интернета.</span></div>
          </div>`
        );
      }
    });
  }

  updateInstallUI();
  updateOnlineUI();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
  }
}
