// ==UserScript==
// @name         ÖBA Video Kontrolcüsü & Otomatik Tamamlayıcı
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  ÖBA (oba.gov.tr) ve EBA için anti-atlama engelini kaldıran, videoyu anında son saniyelere saran, hızlandıran ve bitince Ctrl+Alt+. tetikleyen tam kontrolcü
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

    // Sitenin 'seeking' (sarma) ve 'ratechange' (hız) olaylarını dinleyip süreyi geri almasını engelle
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        // Eğer bir video veya oynatıcı 'seeking' engelleyicisi eklemeye çalışıyorsa engelle
        if (type === 'seeking' || type === 'ratechange') {
            if (this instanceof HTMLMediaElement || (this && this.tagName === 'VIDEO')) {
                // Sitenin araya girip süreyi geri almasını önle
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
    // 2. VİDEO YÖNETİMİ & GERÇEK ZAMAN SARMA
    // ==========================================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getVideo() {
        return document.querySelector('video');
    }

    // VideoJS / Oynatıcı nesnelerinin engellerini kaldır ve zamanı ayarla
    function applyTime(video, targetTime) {
        if (!video) return;

        // 1. Video.js Oynatıcılarını Çöz
        try {
            if (window.videojs) {
                const players = window.videojs.getAllPlayers ? window.videojs.getAllPlayers() : Object.values(window.videojs.players || {});
                players.forEach(player => {
                    if (player) {
                        try { if (player.off) player.off('seeking'); } catch(e) {}
                        if (typeof player.currentTime === 'function') {
                            player.currentTime(targetTime);
                        }
                        if (player.paused && typeof player.play === 'function') {
                            player.play();
                        }
                    }
                });
            }
        } catch (e) {}

        // 2. HTMLMediaElement Prototype Setter
        try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
            if (descriptor && descriptor.set) {
                descriptor.set.call(video, targetTime);
            } else {
                video.currentTime = targetTime;
            }
        } catch (err) {
            video.currentTime = targetTime;
        }

        // 3. Eventleri tetikle
        try {
            video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
            video.dispatchEvent(new Event('seeked', { bubbles: true }));
        } catch (e) {}

        if (video.paused) {
            video.play().catch(() => {});
        }
    }

    // Hızı Zorla Ayarla
    function applySpeed(video, rate) {
        if (!video) return;
        video.playbackRate = rate;

        try {
            if (window.videojs) {
                const players = window.videojs.getAllPlayers ? window.videojs.getAllPlayers() : Object.values(window.videojs.players || {});
                players.forEach(p => {
                    if (p && typeof p.playbackRate === 'function') p.playbackRate(rate);
                });
            }
        } catch (e) {}
    }

    // "Ctrl + Alt + ." Tuş Kombinasyonunu Tetikle
    async function triggerCtrlAltDot() {
        await sleep(500);

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
        try { if (window.parent && window.parent !== window) targets.push(window.parent.document, window.parent); } catch(e){}
        try { if (window.top && window.top !== window) targets.push(window.top.document, window.top); } catch(e){}

        targets.forEach(target => {
            if (target && target.dispatchEvent) {
                try {
                    target.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                } catch(e) {}
            }
        });
    }

    // ==========================================
    // 3. GUI VE AYARLAR
    // ==========================================
    const defaultSettings = {
        forwardKey: 'l',
        backwardKey: 'j',
        speedUpKey: 'h',
        speedDownKey: 'g',
        skipTime: 10,
        endOffsetSec: 2
    };

    function getSettings() {
        try {
            const saved = localStorage.getItem('obaVideoControllerSettings');
            if (saved) return Object.assign({}, defaultSettings, JSON.parse(saved));
        } catch (e) {}
        return defaultSettings;
    }

    let settings = getSettings();

    function createGUI() {
        if (document.getElementById('vc-gui-container')) return;
        if (!document.body) return;

        const guiHTML = `
            <div id="vc-gui-container" style="position: fixed; top: 15px; right: 15px; width: 290px; background: rgba(20, 21, 27, 0.95); color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; padding: 12px; z-index: 2147483647; box-shadow: 0 8px 30px rgba(0,0,0,0.8); border: 1px solid #33374a; font-size: 12px; user-select: none; backdrop-filter: blur(8px);">
                <!-- Başlık & Sürükleme -->
                <div id="vc-header-drag" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #2d3142; padding-bottom: 6px; margin-bottom: 10px; cursor: move;">
                    <h3 style="margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; color: #00cec9; pointer-events: none;">
                        <span>⚡</span> ÖBA Video Kontrol
                    </h3>
                    <button id="vc-toggle-btn" style="background: #252836; border: 1px solid #444a60; color: #fff; cursor: pointer; font-size: 11px; border-radius: 4px; padding: 2px 6px;">➖</button>
                </div>
                
                <div id="vc-gui-content">
                    <!-- Sona Sar & Tuşla Bölümü -->
                    <div style="background: #191b24; padding: 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #2d3142;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-weight: 600; font-size: 11px; color: #00d2d3;">Kalan Süre (Bitişe kala):</span>
                            <span id="vc-offset-val" style="font-weight: 700; color: #00d2d3; font-size: 12px;">${settings.endOffsetSec} sn</span>
                        </div>
                        <input type="range" id="vc-end-offset" min="1" max="30" step="1" value="${settings.endOffsetSec}" style="width: 100%; accent-color: #00d2d3; cursor: pointer; margin-bottom: 8px;">
                        
                        <button id="vc-skip-end-btn" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 11px; box-shadow: 0 3px 10px rgba(0,206,201,0.3); transition: 0.2s;">
                            ⏩ Sona Sar & Bitince Tuşla (Ctrl+Alt+.)
                        </button>
                    </div>

                    <!-- Kısayollar -->
                    <div style="font-size: 10px; color: #8892b0; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Klavye Kısayolları</div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">İleri Sar</label>
                            <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #191b24; color: #fff; border: 1px solid #33374a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Geri Sar</label>
                            <input type="text" id="vc-bwd-key" value="${settings.backwardKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #191b24; color: #fff; border: 1px solid #33374a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Hızlandır</label>
                            <input type="text" id="vc-sup-key" value="${settings.speedUpKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #191b24; color: #fff; border: 1px solid #33374a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Yavaşlat</label>
                            <input type="text" id="vc-sdwn-key" value="${settings.speedDownKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #191b24; color: #fff; border: 1px solid #33374a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div style="grid-column: span 2;">
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Atlama Miktarı (Saniye)</label>
                            <input type="number" id="vc-skip-time" value="${settings.skipTime}" style="width: 100%; padding: 4px; box-sizing: border-box; background: #191b24; color: #fff; border: 1px solid #33374a; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                    </div>
                    
                    <button id="vc-save-btn" style="width: 100%; padding: 6px; background: #2f3542; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; transition: 0.2s;">
                        💾 Ayarları Kaydet
                    </button>
                    <div id="vc-status" style="font-size: 10px; color: #00cec9; text-align: center; margin-top: 6px; display: none; line-height: 1.3; padding: 3px; border-radius: 4px;"></div>
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
        const skipEndBtn = document.getElementById('vc-skip-end-btn');
        const endOffsetSlider = document.getElementById('vc-end-offset');
        const endOffsetVal = document.getElementById('vc-offset-val');
        const statusText = document.getElementById('vc-status');
        const headerDrag = document.getElementById('vc-header-drag');

        const showStatus = (msg, duration = 2500, color = '#00cec9') => {
            if (!statusText) return;
            statusText.textContent = msg;
            statusText.style.color = color;
            statusText.style.background = 'rgba(0, 206, 201, 0.1)';
            statusText.style.display = 'block';
            if (duration > 0) {
                setTimeout(() => {
                    if (statusText) statusText.style.display = 'none';
                }, duration);
            }
        };

        // Slider Değişimi
        endOffsetSlider.addEventListener('input', (e) => {
            endOffsetVal.textContent = `${e.target.value} sn`;
            settings.endOffsetSec = parseInt(e.target.value, 10);
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
            settings.backwardKey = document.getElementById('vc-bwd-key').value.toLowerCase();
            settings.speedUpKey = document.getElementById('vc-sup-key').value.toLowerCase();
            settings.speedDownKey = document.getElementById('vc-sdwn-key').value.toLowerCase();
            settings.skipTime = parseInt(document.getElementById('vc-skip-time').value, 10) || 10;
            settings.endOffsetSec = parseInt(endOffsetSlider.value, 10) || 2;

            try {
                localStorage.setItem('obaVideoControllerSettings', JSON.stringify(settings));
            } catch (e) {}
            showStatus('✅ Ayarlar Kaydedildi!', 2000, '#00b894');
        });

        // Sona Sar ve Bitişte Tetikle
        skipEndBtn.addEventListener('click', async () => {
            const video = getVideo();
            if (!video) {
                showStatus('⚠️ Bu alanda video bulunamadı!', 3000, '#ff7675');
                return;
            }

            const duration = video.duration;
            if (!duration || isNaN(duration) || duration <= 0) {
                showStatus('⚠️ Video süresi henüz yüklenmedi, önce videoyu başlatın!', 3000, '#ff7675');
                return;
            }

            const offset = parseInt(endOffsetSlider.value, 10) || 2;
            const targetTime = Math.max(0, duration - offset);

            showStatus(`⏳ Son ${offset} sn'ye sarılıyor...`, 0, '#ffeaa7');

            // 1. Adım: Sürekli ve zorlayıcı sarma uygula
            let seekAttempts = 0;
            const seekLoop = setInterval(() => {
                applyTime(video, targetTime);
                seekAttempts++;
                // Video hedef süreye ulaştıysa veya 10 deneme bittiyse durdur
                if (Math.abs(video.currentTime - targetTime) <= 2 || seekAttempts >= 10) {
                    clearInterval(seekLoop);
                }
            }, 100);

            // 2. Adım: Eğer video akışı HLS sebebiyle sarılamadıysa Turbo 16x modunu devreye sok
            setTimeout(() => {
                if (video.currentTime < targetTime - 5) {
                    showStatus('⚡ Turbo Hız Modu (16x) Aktif...', 0, '#00d2d3');
                    applySpeed(video, 16);
                }
            }, 1200);

            // 3. Adım: Gerçekten bitişe ulaşıldığını periyodik olarak kontrol et
            let checkFinishedInterval = setInterval(async () => {
                const isNearEnd = (video.currentTime >= video.duration - Math.min(offset, 1.5)) || video.ended;
                
                if (isNearEnd && video.duration > 5) {
                    clearInterval(checkFinishedInterval);

                    showStatus('⏳ Video tamamlandı, bekleniyor...', 0, '#74b9ff');
                    await sleep(800);

                    await triggerCtrlAltDot();
                    showStatus('✅ "Ctrl + Alt + ." başarıyla basıldı!', 4000, '#55efc4');
                }
            }, 300);
        });
    }

    // --- KLAVYE DİNLEYİCİSİ ---
    document.addEventListener('keydown', function(e) {
        const activeTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || e.target.isContentEditable) return;

        const video = getVideo();
        if (!video) return;

        const key = e.key.toLowerCase();
        const skipSecs = settings.skipTime;

        switch(key) {
            case settings.forwardKey:
                applyTime(video, video.currentTime + skipSecs);
                break;
            case settings.backwardKey:
                applyTime(video, Math.max(0, video.currentTime - skipSecs));
                break;
            case settings.speedUpKey:
                const newUpRate = Math.min(16, (video.playbackRate || 1) + 0.5);
                applySpeed(video, newUpRate);
                break;
            case settings.speedDownKey:
                const newDownRate = Math.max(0.25, (video.playbackRate || 1) - 0.25);
                applySpeed(video, newDownRate);
                break;
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