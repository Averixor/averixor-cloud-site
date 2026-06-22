/**
 * Averixor Cloud — URL хмари (Nextcloud) для статичного сайту та workspace.
 * Не використовуйте /login — Nextcloud віддає 404; корінь редіректить на index.php/login.
 * Змініть enabled на false, якщо Nextcloud тимчасово недоступний.
 */
(function () {
  'use strict';

  var CLOUD_URL = 'https://cloud.averixor.xyz/';

  window.AverixorCloudConfig = Object.freeze({
    url: CLOUD_URL,
    enabled: true,
    notConnectedMessage:
      'Хмара ще не підключена або тимчасово недоступна.',
  });

  window.openAverixorCloud = function openAverixorCloud() {
    var cfg = window.AverixorCloudConfig;
    if (!cfg || cfg.enabled !== true) {
      window.alert(
        (cfg && cfg.notConnectedMessage) ||
          'Хмара ще не підключена або тимчасово недоступна.',
      );
      return;
    }
    window.open(cfg.url || CLOUD_URL, '_blank', 'noopener');
  };
})();
