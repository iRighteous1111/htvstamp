// ==UserScript==
// @name         ÖBA Video Kontrolcüsü & Tam Otomatik Geçici
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  ÖBA (oba.gov.tr) ve EBA için video içi kontrolcüsü: Gelişmiş bekleme süreleri, yeşil/kırmızı şalter butonlu tam otomatik döngü ve ileri sarma asistanı.
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

    // Arka plan (Blur) Koruması
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
        postPassDelay: 4,     // Video geçildikten sonraki yüklenme/oturma bekleme süresi (sn)
        prePassDelay: 1.5,    // İleri sarıldıktan sonra tuşlamadan önceki bekleme süresi (sn)
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
    // 4. İLERLET & BEKLE & GEÇ DÖNGÜSÜ
    // ==========================================
    let isProcessing = false;

    async function executeSkipAndPass(customSkipSecs, customPrePassDelay, showStatusCallback) {
        if (isProcessing) return;
        const video = getVideo();
        if (!video) {
            if (showStatusCallback) showStatusCallback('⚠️ Video bulunamadı!', 2000, '#ff7675');
            return;
        }

        isProcessing = true;
        const skipSecs = customSkipSecs || settings.skipTime || 10;
        const waitDelay = (customPrePassDelay !== undefined ? customPrePassDelay : settings.prePassDelay) || 1.5;

        if (showStatusCallback) showStatusCallback(`⏳ ${skipSecs} sn ileri sarılıyor...`, 0, '#ffeaa7');

        // 1. İleri sar
        forceSeek(video, video.currentTime + skipSecs);

        // 2. Belirlenen süre kadar bekle
        if (showStatusCallback) showStatusCallback(`⏳ ${waitDelay} sn bekleniyor...`, 0, '#74b9ff');
        await sleep(waitDelay * 1000);

        // 3. Ctrl + Alt + . bas
        await triggerCtrlAltDot();
        if (showStatusCallback) showStatusCallback('✅ "Ctrl + Alt + ." tuşlandı!', 2500, '#55efc4');

        isProcessing = false;
    }

    // ==========================================
    // 5. TAM OTOMATİK MOD DÖNGÜSÜ (LEVER KONTROLLÜ)
    // ==========================================
    let lastProcessedVideoSrc = '';

    async function checkAutoMode() {
        if (!settings.autoMode || isProcessing) return;

        const video = getVideo();
        if (!video) return;

        const currentSrc = video.currentSrc || video.src || window.location.href;
        
        // Yeni bir video tespit edildiğinde
        if (currentSrc && currentSrc !== lastProcessedVideoSrc && !video.dataset.obaHandled) {
            video.dataset.obaHandled = 'true';
            lastProcessedVideoSrc = currentSrc;

            const postDelay = settings.postPassDelay || 4;

            if (window.__obaShowStatus) {
                window.__obaShowStatus(`🔁 Yeni video algılandı, ${postDelay} sn bekleniyor...`, 0, '#ffeaa7');
            }

            // Videonun oturması için kullanıcı tarafından belirlenen süre kadar bekle
            for (let i = postDelay; i > 0; i--) {
                if (!settings.autoMode) return; // Kullanıcı durdurduysa çık
                if (window.__obaShowStatus) {
                    window.__obaShowStatus(`🔁 Video yükleniyor... (${i} sn kaldı)`, 0, '#ffeaa7');
                }
                await sleep(1000);
            }

            if (!settings.autoMode) return;

            // İleri sar, bekle ve geç
            await executeSkipAndPass(settings.skipTime, settings.prePassDelay, (msg, dur, col) => {
                if (window.__obaShowStatus) window.__obaShowStatus(`🔁 [Otomatik]: ${msg}`, dur, col);
            });
        }
    }

    setInterval(checkAutoMode, 1000);

    // ==========================================
    // 6. GUI OLUŞTURUCU (ŞALTERLİ & AYAR PANELLİ)
    // ==========================================
    function createGUI() {
        const video = getVideo();
        if (!video && !document.querySelector('.vjs-tech') && !document.querySelector('.video-js')) {
            return;
        }

        if (document.getElementById('vc-gui-container')) return;
        if (!document.body) return;

        const isAuto = settings.autoMode;

        const guiHTML = `
            <div id="vc-gui-container" style="position: fixed; top: 15px; right: 15px; width: 295px; background: rgba(18, 20, 26, 0.97); color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 12px; padding: 12px; z-index: 2147483647; box-shadow: 0 10px 35px rgba(0,0,0,0.9); border: 1px solid #33384a; font-size: 12px; user-select: none; backdrop-filter: blur(12px);">
                <!-- Başlık & Sürükleme -->
                <div id="vc-header-drag" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #282c3c; padding-bottom: 6px; margin-bottom: 10px; cursor: move;">
                    <h3 style="margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; color: #00cec9; pointer-events: none;">
                        <span>⚡</span> ÖBA Video Asistanı
                    </h3>
                    <button id="vc-toggle-btn" style="background: #232736; border: 1px solid #42475c; color: #fff; cursor: pointer; font-size: 11px; border-radius: 4px; padding: 2px 6px;">➖</button>
                </div>
                
                <div id="vc-gui-content">
                    <!-- ANA ŞALTER (LEVER) BUTONU -->
                    <button id="vc-lever-btn" style="width: 100%; padding: 11px; margin-bottom: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.3s ease; box-shadow: 0 4px 15px ${isAuto ? 'rgba(214,48,49,0.4)' : 'rgba(0,184,148,0.4)'}; background: ${isAuto ? 'linear-gradient(135deg, #d63031, #e17055)' : 'linear-gradient(135deg, #00b894, #00cec9)'}; color: #fff;">
                        ${isAuto ? '🔴 Otomatik Mod: ÇALIŞIYOR (Durdur)' : '🟢 Otomatik Mod: HAZIR (Başlat)'}
                    </button>

                    <!-- Tek Seferlik Hızlı Aksiyonlar -->
                    <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                        <button id="vc-main-btn" style="flex: 2; padding: 7px; background: #2f3542; color: #fff; border: 1px solid #485460; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 11px;">
                            ⏩ <span id="vc-btn-sec">${settings.skipTime}</span>sn Sar & Geç
                        </button>
                        <button id="vc-instant-pass-btn" title="Beklemeden doğrudan Ctrl+Alt+. gönderir" style="flex: 1; padding: 7px; background: #353b48; color: #f5f6fa; border: 1px solid #485460; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 11px;">
                            ⚡ Hemen Geç
                        </button>
                    </div>

                    <!-- OTOMATİK MOD AYARLARI BÖLÜMÜ -->
                    <div style="background: #171922; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #282c3c;">
                        <div style="font-size: 11px; font-weight: 700; color: #00cec9; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                            <span>⚙️</span> Otomatik Mod Ayarları
                        </div>

                        <!-- 1. İleri Sarma Süresi -->
                        <div style="margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; color: #a4b0be;">
                                <span>İleri Sarma Miktarı:</span>
                                <span id="vc-skip-val" style="font-weight: 700; color: #00d2d3;">${settings.skipTime} sn</span>
                            </div>
                            <input type="range" id="vc-skip-slider" min="5" max="120" step="5" value="${settings.skipTime}" style="width: 100%; accent-color: #00d2d3; cursor: pointer;">
                        </div>

                        <!-- 2. Videoyu Geçtikten Sonra Bekleme Süresi (Yüklenme) -->
                        <div style="margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; color: #a4b0be;">
                                <span>Yeni Video Yüklenme Beklemesi:</span>
                                <span id="vc-post-val" style="font-weight: 700; color: #ffeaa7;">${settings.postPassDelay} sn</span>
                            </div>
                            <input type="range" id="vc-post-slider" min="1" max="20" step="1" value="${settings.postPassDelay}" style="width: 100%; accent-color: #ffeaa7; cursor: pointer;">
                        </div>

                        <!-- 3. Tuşlamadan Önce Bekleme Süresi -->
                        <div style="margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; color: #a4b0be;">
                                <span>Tuşlamadan Önceki Bekleme:</span>
                                <span id="vc-pre-val" style="font-weight: 700; color: #74b9ff;">${settings.prePassDelay} sn</span>
                            </div>
                            <input type="range" id="vc-pre-slider" min="0.5" max="5" step="0.5" value="${settings.prePassDelay}" style="width: 100%; accent-color: #74b9ff; cursor: pointer;">
                        </div>

                        <!-- Kısayol Tuşu -->
                        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; border-top: 1px solid #232736;">
                            <span style="font-size: 10px; color: #a4b0be;">Manuel İleri Sar Tuşu:</span>
                            <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 35px; padding: 2px; box-sizing: border-box; background: #232736; color: #fff; border: 1px solid #3d4358; text-align: center; border-radius: 4px; outline: none; font-size: 11px; font-weight: bold;">
                        </div>
                    </div>
                    
                    <button id="vc-save-btn" style="width: 100%; padding: 6px; background: #2b3040; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 11px; transition: 0.2s;">
                        💾 Ayarları Kaydet
                    </button>
                    <div id="vc-status" style="font-size: 10px; color: #00cec9; text-align: center; margin-top: 6px; display: none; line-height: 1.3; padding: 5px; border-radius: 4px; font-weight: 600;"></div>
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
        const leverBtn = document.getElementById('vc-lever-btn');
        const saveBtn = document.getElementById('vc-save-btn');
        const mainBtn = document.getElementById('vc-main-btn');
        const instantPassBtn = document.getElementById('vc-instant-pass-btn');
        
        const skipSlider = document.getElementById('vc-skip-slider');
        const skipValText = document.getElementById('vc-skip-val');
        const btnSecText = document.getElementById('vc-btn-sec');

        const postSlider = document.getElementById('vc-post-slider');
        const postValText = document.getElementById('vc-post-val');

        const preSlider = document.getElementById('vc-pre-slider');
        const preValText = document.getElementById('vc-pre-val');

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

        // Slider Dinleyicileri
        skipSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            skipValText.textContent = `${val} sn`;
            btnSecText.textContent = val;
            settings.skipTime = val;
        });

        postSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            postValText.textContent = `${val} sn`;
            settings.postPassDelay = val;
        });

        preSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            preValText.textContent = `${val} sn`;
            settings.prePassDelay = val;
        });

        // ŞALTER (LEVER) BUTONU: TIKLANDIKÇA KIRMIZI / YEŞİL DÖNÜŞÜMÜ
        const updateLeverButtonState = () => {
            if (settings.autoMode) {
                leverBtn.textContent = '🔴 Otomatik Mod: ÇALIŞIYOR (Durdur)';
                leverBtn.style.background = 'linear-gradient(135deg, #d63031, #e17055)';
                leverBtn.style.boxShadow = '0 4px 15px rgba(214,48,49,0.5)';
            } else {
                leverBtn.textContent = '🟢 Otomatik Mod: HAZIR (Başlat)';
                leverBtn.style.background = 'linear-gradient(135deg, #00b894, #00cec9)';
                leverBtn.style.boxShadow = '0 4px 15px rgba(0,184,148,0.4)';
            }
        };

        leverBtn.addEventListener('click', () => {
            settings.autoMode = !settings.autoMode;
            try {
                localStorage.setItem('obaVideoControllerSettings', JSON.stringify(settings));
            } catch (err) {}
            
            updateLeverButtonState();

            if (settings.autoMode) {
                window.__obaShowStatus('🟢 Otomatik Mod Başlatıldı! Sırayla ilerleyecek.', 2000, '#55efc4');
                lastProcessedVideoSrc = ''; // Hemen geçerli videoyu işle
                checkAutoMode();
            } else {
                window.__obaShowStatus('🔴 Otomatik Mod Durduruldu.', 2000, '#ff7675');
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
            settings.postPassDelay = parseInt(postSlider.value, 10) || 4;
            settings.prePassDelay = parseFloat(preSlider.value) || 1.5;

            try {
                localStorage.setItem('obaVideoControllerSettings', JSON.stringify(settings));
            } catch (e) {}
            window.__obaShowStatus('✅ Tüm Ayarlar Kaydedildi!', 2000, '#00b894');
        });

        // Tek Seferlik Manuel İşlem
        mainBtn.addEventListener('click', () => {
            executeSkipAndPass(settings.skipTime, settings.prePassDelay, window.__obaShowStatus);
        });

        // Doğrudan Hemen Geç Butonu
        instantPassBtn.addEventListener('click', async () => {
            window.__obaShowStatus('⚡ "Ctrl + Alt + ." gönderiliyor...', 1000, '#ffeaa7');
            await triggerCtrlAltDot();
            window.__obaShowStatus('✅ "Ctrl + Alt + ." basıldı!', 2000, '#55efc4');
        });
    }

    // --- KLAVYE DİNLEYİCİSİ ---
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