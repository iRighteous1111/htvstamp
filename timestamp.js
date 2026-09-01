// ==UserScript==
// @name         ÖBA Video Kontrolcüsü & Tam Otomatik Geçici
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  ÖBA (oba.gov.tr) ve EBA için video içi kontrolcüsü: X saniye ileri sarar, 1 sn bekler ve Ctrl+Alt+. ile videoyu geçer. Tam otomatik mod seçeneği içerir.
// @match        *://*.oba.gov.tr/*
// @match        *://oba.gov.tr/*
// @match        *://*.eba.gov.tr/*
// @match        *://eba.gov.tr/*
// @match        *://*.meb.gov.tr/*
// @match        *://meb.gov.tr/*
// @include      *://*oba.gov.tr/*
// @include      *://*eba.gov.tr/*
// @include      *://*meb.gov.tr/*
// @include      *oba.gov.tr*
// @include      *eba.gov.tr*
// @include      *meb.gov.tr*
// @grant        none
// @run-at       document-start
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. SİTE ENGELLEMELERİNİ NÖTRALİZE ETME
    // ==========================================
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'seeking' || type === 'ratechange') {
            if (this instanceof HTMLMediaElement || (this && this.tagName === 'VIDEO')) {
                return;
            }
        }
        return originalAddEventListener.apply(this, arguments);
    };

    // Arka plan (Blur) Koruması - Sekme değiştiğinde video durmasın
    try {
        window.addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
        window.addEventListener('focusout', (e) => e.stopImmediatePropagation(), true);
        document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
        window.onblur = null;
        document.onvisibilitychange = null;

        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    } catch (e) {}

    // ==========================================
    // 2. VİDEO YÖNETİMİ & TUŞ TETİKLEME
    // ==========================================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getVideo() {
        return document.querySelector('video');
    }

    // İlerleme çubuğuna tıklama simülasyonu
    function simulateProgressBarClick(percent) {
        const selectors = [
            '.vjs-progress-holder',
            '.vjs-progress-control',
            '.vjs-slider',
            '.plyr__progress input',
            '.jw-slider-time',
            '[role="slider"]',
            '.progress-bar',
            '.video-progress'
        ];

        for (const sel of selectors) {
            const bar = document.querySelector(sel);
            if (bar) {
                const rect = bar.getBoundingClientRect();
                if (rect.width > 0) {
                    const clickX = rect.left + (rect.width * Math.max(0, Math.min(0.99, percent)));
                    const clickY = rect.top + (rect.height / 2);

                    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                        const evt = new MouseEvent(eventType, {
                            bubbles: true,
                            cancelable: true,
                            clientX: clickX,
                            clientY: clickY,
                            view: window
                        });
                        bar.dispatchEvent(evt);
                    });
                    return true;
                }
            }
        }
        return false;
    }

    // Videoyu ileri sar
    function forceSeek(video, targetTime) {
        if (!video) return;

        try {
            if (typeof video.fastSeek === 'function') {
                video.fastSeek(targetTime);
            }
        } catch (e) {}

        try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
            if (descriptor && descriptor.set) {
                descriptor.set.call(video, targetTime);
            } else {
                video.currentTime = targetTime;
            }
        } catch (e) {
            video.currentTime = targetTime;
        }

        try {
            if (window.videojs) {
                const players = window.videojs.getAllPlayers ? window.videojs.getAllPlayers() : Object.values(window.videojs.players || {});
                players.forEach(player => {
                    if (player) {
                        try { if (player.off) player.off('seeking'); } catch (err) {}
                        if (typeof player.currentTime === 'function') player.currentTime(targetTime);
                        if (player.paused && typeof player.play === 'function') player.play();
                    }
                });
            }
        } catch (e) {}

        if (video.duration > 0) {
            simulateProgressBarClick(targetTime / video.duration);
        }

        try {
            video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
            video.dispatchEvent(new Event('seeked', { bubbles: true }));
        } catch (e) {}

        if (video.paused) {
            video.play().catch(() => {});
        }
    }

    // "Ctrl + Alt + ." Tuş Kombinasyonunu Tetikle
    async function triggerCtrlAltDot() {
        await sleep(300);

        const eventOptions = {
            key: '.',
            code: 'Period',
            keyCode: 190,
            which: 190,
            ctrlKey: true,
            altKey: true,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
        };

        const targets = [document.activeElement, document.body, document, window];
        try { if (window.parent && window.parent !== window) targets.push(window.parent.document, window.parent); } catch (e) {}
        try { if (window.top && window.top !== window) targets.push(window.top.document, window.top); } catch (e) {}

        targets.forEach(target => {
            if (target && target.dispatchEvent) {
                try {
                    target.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                } catch (e) {}
            }
        });
    }

    // ==========================================
    // 3. AYARLAR & LOCALSTORAGE
    // ==========================================
    const defaultSettings = {
        forwardKey: 'l',
        skipTime: 10,
        autoMode: false
    };

    function getSettings() {
        try {
            const saved = localStorage.getItem('obaVideoControllerSettings');
            if (saved) return Object.assign({}, defaultSettings, JSON.parse(saved));
        } catch (e) {}
        return defaultSettings;
    }

    let settings = getSettings();

    // ==========================================
    // 4. ANA İŞLEM: İLERİ SAR + 1 SN BEKLE + GEÇ
    // ==========================================
    let isProcessing = false;

    async function executeSkipAndPass(showStatusCallback) {
        if (isProcessing) return;
        const video = getVideo();
        if (!video) {
            if (showStatusCallback) showStatusCallback('⚠️ Video bulunamadı!', 2000, '#ff7675');
            return;
        }

        isProcessing = true;
        const skipSecs = settings.skipTime || 10;

        if (showStatusCallback) showStatusCallback(`⏳ ${skipSecs} sn ileri sarılıyor...`, 0, '#ffeaa7');

        // 1. İleri sar
        forceSeek(video, video.currentTime + skipSecs);

        // 2. 1 saniye bekle
        if (showStatusCallback) showStatusCallback('⏳ 1 saniye bekleniyor...', 0, '#74b9ff');
        await sleep(1000);

        // 3. Ctrl + Alt + . bas
        await triggerCtrlAltDot();
        if (showStatusCallback) showStatusCallback('✅ "Ctrl + Alt + ." tuşlandı!', 2500, '#55efc4');

        isProcessing = false;
    }

    // ==========================================
    // 5. TAM OTOMATİK MOD DÖNGÜSÜ
    // ==========================================
    let lastProcessedVideoSrc = '';

    async function checkAutoMode() {
        if (!settings.autoMode || isProcessing) return;

        const video = getVideo();
        if (!video) return;

        const currentSrc = video.currentSrc || video.src || window.location.href;
        
        // Yeni bir video yüklendiğinde veya henüz işlenmediğinde
        if (currentSrc && currentSrc !== lastProcessedVideoSrc && !video.dataset.obaHandled) {
            video.dataset.obaHandled = 'true';
            lastProcessedVideoSrc = currentSrc;

            // Videonun başlaması ve oturması için 1.5 sn doğal bekleme
            await sleep(1500);

            if (settings.autoMode) {
                executeSkipAndPass((msg, dur, col) => {
                    if (window.__obaShowStatus) window.__obaShowStatus(`🔁 [Otomatik]: ${msg}`, dur, col);
                });
            }
        }
    }

    // Periyodik otomatik mod kontrolü
    setInterval(checkAutoMode, 1000);

    // ==========================================
    // 6. SADECE VİDEO OLAN YERDE GUI OLUŞTUR
    // ==========================================
    function createGUI() {
        // Videonun olmadığı dış sayfalarda GUI ÇIKARMA (Gereksiz fazlalık önlenir)
        const video = getVideo();
        if (!video && !document.querySelector('.vjs-tech') && !document.querySelector('.video-js')) {
            return;
        }

        if (document.getElementById('vc-gui-container')) return;
        if (!document.body) return;

        const guiHTML = `
            <div id="vc-gui-container" style="position: fixed; top: 15px; right: 15px; width: 280px; background: rgba(18, 20, 26, 0.96); color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; padding: 12px; z-index: 2147483647; box-shadow: 0 8px 32px rgba(0,0,0,0.85); border: 1px solid #33384a; font-size: 12px; user-select: none; backdrop-filter: blur(10px);">
                <!-- Başlık & Sürükleme -->
                <div id="vc-header-drag" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #282c3c; padding-bottom: 6px; margin-bottom: 10px; cursor: move;">
                    <h3 style="margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; color: #00cec9; pointer-events: none;">
                        <span>⚡</span> ÖBA Video Asistanı
                    </h3>
                    <button id="vc-toggle-btn" style="background: #232736; border: 1px solid #42475c; color: #fff; cursor: pointer; font-size: 11px; border-radius: 4px; padding: 2px 6px;">➖</button>
                </div>
                
                <div id="vc-gui-content">
                    <!-- İleri Sarma Miktarı Slider -->
                    <div style="background: #171922; padding: 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #282c3c;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-weight: 600; font-size: 11px; color: #00d2d3;">İleri Sarma Süresi:</span>
                            <span id="vc-skip-val" style="font-weight: 700; color: #00d2d3; font-size: 12px;">${settings.skipTime} sn</span>
                        </div>
                        <input type="range" id="vc-skip-slider" min="5" max="120" step="5" value="${settings.skipTime}" style="width: 100%; accent-color: #00d2d3; cursor: pointer; margin-bottom: 8px;">
                        
                        <!-- Ana Eylem Butonları -->
                        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                            <button id="vc-main-btn" style="flex: 2; padding: 9px; background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 11px; box-shadow: 0 3px 10px rgba(0,206,201,0.25); transition: 0.2s;">
                                ⏩ <span id="vc-btn-sec">${settings.skipTime}</span>sn Sar & Geç
                            </button>
                            <button id="vc-instant-pass-btn" title="Beklemeden Ctrl+Alt+. gönderir" style="flex: 1; padding: 9px; background: #e17055; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 11px; box-shadow: 0 3px 10px rgba(225,112,85,0.25);">
                                ⚡ Geç
                            </button>
                        </div>

                        <!-- Tam Otomatik Checkbox -->
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ffeaa7; cursor: pointer; background: #202430; padding: 6px 8px; border-radius: 5px; border: 1px solid #383e54;">
                            <input type="checkbox" id="vc-auto-checkbox" ${settings.autoMode ? 'checked' : ''} style="cursor: pointer; accent-color: #00cec9; width: 14px; height: 14px;">
                            <span style="font-weight: 600;">🔁 Tam Otomatik Mod (Sırayla Bitir)</span>
                        </label>
                    </div>

                    <!-- Kısayol Ayarı -->
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #171922; padding: 6px 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #282c3c;">
                        <span style="font-size: 11px; color: #a4b0be;">İleri Sar Tuşu:</span>
                        <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 45px; padding: 3px; box-sizing: border-box; background: #232736; color: #fff; border: 1px solid #3d4358; text-align: center; border-radius: 4px; outline: none; font-size: 11px; font-weight: bold;">
                    </div>
                    
                    <button id="vc-save-btn" style="width: 100%; padding: 6px; background: #2b3040; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; transition: 0.2s;">
                        💾 Ayarları Kaydet
                    </button>
                    <div id="vc-status" style="font-size: 10px; color: #00cec9; text-align: center; margin-top: 6px; display: none; line-height: 1.3; padding: 4px; border-radius: 4px;"></div>
                </div>
            </div>
        `;

        const guiWrapper = document.createElement('div');
        guiWrapper.id = 'vc-wrapper';
        guiWrapper.innerHTML = guiHTML;
        document.body.appendChild(guiWrapper);

        const container = document.getElementById('vc-gui-container');
        const content = document.getElementById('vc-gui-content');
        const toggleBtn = document.getElementById('vc-toggle-btn');
        const saveBtn = document.getElementById('vc-save-btn');
        const mainBtn = document.getElementById('vc-main-btn');
        const instantPassBtn = document.getElementById('vc-instant-pass-btn');
        const skipSlider = document.getElementById('vc-skip-slider');
        const skipValText = document.getElementById('vc-skip-val');
        const btnSecText = document.getElementById('vc-btn-sec');
        const autoCheckbox = document.getElementById('vc-auto-checkbox');
        const statusText = document.getElementById('vc-status');
        const headerDrag = document.getElementById('vc-header-drag');

        window.__obaShowStatus = (msg, duration = 2500, color = '#00cec9') => {
            if (!statusText) return;
            statusText.textContent = msg;
            statusText.style.color = color;
            statusText.style.background = 'rgba(0, 206, 201, 0.12)';
            statusText.style.display = 'block';
            if (duration > 0) {
                setTimeout(() => {
                    if (statusText) statusText.style.display = 'none';
                }, duration);
            }
        };

        // Slider Değişimi
        skipSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            skipValText.textContent = `${val} sn`;
            btnSecText.textContent = val;
            settings.skipTime = val;
        });

        // Checkbox Değişimi (Anında kaydeder)
        autoCheckbox.addEventListener('change', (e) => {
            settings.autoMode = e.target.checked;
            try {
                localStorage.setItem('obaVideoControllerSettings', JSON.stringify(settings));
            } catch (err) {}
            if (settings.autoMode) {
                window.__obaShowStatus('🔁 Tam Otomatik Mod Aktif Edildi!', 2000, '#ffeaa7');
                checkAutoMode();
            } else {
                window.__obaShowStatus('⏸️ Otomatik Mod Kapatıldı.', 2000, '#a4b0be');
            }
        });

        container.addEventListener('keydown', (e) => e.stopPropagation());

        // Sürükle Bırak
        let isDragging = false, startX, startY, initialLeft, initialTop;
        headerDrag.addEventListener('mousedown', (e) => {
            if (e.target === toggleBtn) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            container.style.right = 'auto';
            container.style.left = initialLeft + 'px';
            container.style.top = initialTop + 'px';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            container.style.left = Math.max(10, initialLeft + dx) + 'px';
            container.style.top = Math.max(10, initialTop + dy) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Küçült / Büyüt
        toggleBtn.addEventListener('click', () => {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggleBtn.textContent = '➖';
            } else {
                content.style.display = 'none';
                toggleBtn.textContent = '➕';
            }
        });

        // Ayarları Kaydet
        saveBtn.addEventListener('click', () => {
            settings.forwardKey = document.getElementById('vc-fwd-key').value.toLowerCase();
            settings.skipTime = parseInt(skipSlider.value, 10) || 10;
            settings.autoMode = autoCheckbox.checked;

            try {
                localStorage.setItem('obaVideoControllerSettings', JSON.stringify(settings));
            } catch (e) {}
            window.__obaShowStatus('✅ Ayarlar Kaydedildi!', 2000, '#00b894');
        });

        // Ana Buton: İleri Sar + 1 sn Bekle + Geç
        mainBtn.addEventListener('click', () => {
            executeSkipAndPass(window.__obaShowStatus);
        });

        // Doğrudan Hemen Geç Butonu
        instantPassBtn.addEventListener('click', async () => {
            window.__obaShowStatus('⚡ "Ctrl + Alt + ." gönderiliyor...', 1000, '#ffeaa7');
            await triggerCtrlAltDot();
            window.__obaShowStatus('✅ "Ctrl + Alt + ." basıldı!', 2000, '#55efc4');
        });
    }

    // --- KLAVYE DİNLEYİCİSİ (SADECE İLERİ SARMA) ---
    document.addEventListener('keydown', function(e) {
        const activeTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || e.target.isContentEditable) return;

        const video = getVideo();
        if (!video) return;

        const key = e.key.toLowerCase();
        if (key === settings.forwardKey) {
            forceSeek(video, video.currentTime + (settings.skipTime || 10));
        }
    }, true);

    // --- BAŞLATICI ---
    const initInterval = setInterval(() => {
        if (document.body) {
            createGUI();
        }
    }, 500);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createGUI);
    } else {
        createGUI();
    }
})();