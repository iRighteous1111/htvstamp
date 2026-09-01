// ==UserScript==
// @name         ÖBA Video Kontrolcüsü & Otomatik Tamamlayıcı
// @namespace    http://tampermonkey.net/
// @version      0.9
// @description  ÖBA (oba.gov.tr) ve EBA için kesin çalışan video kontrolcüsü, son saniyelere sarma, hızlandırma, ilerleme çubuğu simülasyonu ve otomatik tuş tetikleyici (Ctrl + Alt + .)
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
    // 2. GELİŞMİŞ VİDEO SARMA & HIZLANDIRMA
    // ==========================================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getVideo() {
        return document.querySelector('video');
    }

    // İlerleme çubuğuna (Progress Bar) doğrudan tıklama simülasyonu
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

    // Videoyu kesin olarak hedeflenen zamana sar
    function forceSeek(video, targetTime) {
        if (!video) return;

        // 1. FastSeek ve Standart Setter
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

        // 2. Video.js Oynatıcılarını Sar
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

        // 3. İlerleme çubuğuna tıklatarak arayüzü zorla
        if (video.duration > 0) {
            simulateProgressBarClick(targetTime / video.duration);
        }

        // 4. Eventleri tetikle ve oynat
        try {
            video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
            video.dispatchEvent(new Event('seeked', { bubbles: true }));
        } catch (e) {}

        if (video.paused) {
            video.play().catch(() => {});
        }
    }

    // Hızı Ayarla
    function setSpeed(video, rate) {
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
        await sleep(400);

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
    // 3. GUI VE ETKİLEŞİM
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
            <div id="vc-gui-container" style="position: fixed; top: 15px; right: 15px; width: 295px; background: rgba(18, 20, 26, 0.96); color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; padding: 12px; z-index: 2147483647; box-shadow: 0 8px 32px rgba(0,0,0,0.85); border: 1px solid #33384a; font-size: 12px; user-select: none; backdrop-filter: blur(10px);">
                <!-- Başlık & Sürükleme -->
                <div id="vc-header-drag" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #282c3c; padding-bottom: 6px; margin-bottom: 10px; cursor: move;">
                    <h3 style="margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; color: #00cec9; pointer-events: none;">
                        <span>⚡</span> ÖBA Video Kontrol
                    </h3>
                    <button id="vc-toggle-btn" style="background: #232736; border: 1px solid #42475c; color: #fff; cursor: pointer; font-size: 11px; border-radius: 4px; padding: 2px 6px;">➖</button>
                </div>
                
                <div id="vc-gui-content">
                    <!-- Sona Sar & Tuşla Bölümü -->
                    <div style="background: #171922; padding: 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #282c3c;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-weight: 600; font-size: 11px; color: #00d2d3;">Kalan Süre (Bitişe kala):</span>
                            <span id="vc-offset-val" style="font-weight: 700; color: #00d2d3; font-size: 12px;">${settings.endOffsetSec} sn</span>
                        </div>
                        <input type="range" id="vc-end-offset" min="1" max="30" step="1" value="${settings.endOffsetSec}" style="width: 100%; accent-color: #00d2d3; cursor: pointer; margin-bottom: 8px;">
                        
                        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                            <button id="vc-skip-end-btn" style="flex: 2; padding: 8px; background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 11px; box-shadow: 0 3px 10px rgba(0,206,201,0.25); transition: 0.2s;">
                                ⏩ Sona Sar & Geç
                            </button>
                            <button id="vc-instant-pass-btn" title="Doğrudan Ctrl+Alt+. kombinasyonunu basar" style="flex: 1; padding: 8px; background: #e17055; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 11px; box-shadow: 0 3px 10px rgba(225,112,85,0.25);">
                                ⚡ Hemen Geç
                            </button>
                        </div>
                    </div>

                    <!-- Hızlı Hız Seçici -->
                    <div style="display: flex; align-items: center; justify-content: space-between; background: #171922; padding: 6px 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #282c3c;">
                        <span style="font-size: 11px; color: #a4b0be; font-weight: 600;">Hız:</span>
                        <div style="display: flex; gap: 4px;">
                            <button class="vc-speed-btn" data-speed="1" style="background: #252a3a; color: #fff; border: 1px solid #3c435c; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">1x</button>
                            <button class="vc-speed-btn" data-speed="2" style="background: #252a3a; color: #fff; border: 1px solid #3c435c; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">2x</button>
                            <button class="vc-speed-btn" data-speed="4" style="background: #252a3a; color: #fff; border: 1px solid #3c435c; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">4x</button>
                            <button class="vc-speed-btn" data-speed="8" style="background: #252a3a; color: #fff; border: 1px solid #3c435c; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">8x</button>
                            <button class="vc-speed-btn" data-speed="16" style="background: #00b894; color: #fff; border: none; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold; cursor: pointer;">16x</button>
                        </div>
                    </div>

                    <!-- Kısayollar -->
                    <div style="font-size: 10px; color: #7f8fa6; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Klavye Kısayolları</div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">İleri Sar</label>
                            <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #171922; color: #fff; border: 1px solid #33384a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Geri Sar</label>
                            <input type="text" id="vc-bwd-key" value="${settings.backwardKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #171922; color: #fff; border: 1px solid #33384a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Hızlandır</label>
                            <input type="text" id="vc-sup-key" value="${settings.speedUpKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #171922; color: #fff; border: 1px solid #33384a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div>
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Yavaşlat</label>
                            <input type="text" id="vc-sdwn-key" value="${settings.speedDownKey}" maxlength="1" style="width: 100%; padding: 4px; box-sizing: border-box; background: #171922; color: #fff; border: 1px solid #33384a; text-align: center; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
                        <div style="grid-column: span 2;">
                            <label style="font-size: 10px; display: block; margin-bottom: 2px; color: #a4b0be;">Atlama Miktarı (Saniye)</label>
                            <input type="number" id="vc-skip-time" value="${settings.skipTime}" style="width: 100%; padding: 4px; box-sizing: border-box; background: #171922; color: #fff; border: 1px solid #33384a; border-radius: 4px; outline: none; font-size: 11px;">
                        </div>
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
        const skipEndBtn = document.getElementById('vc-skip-end-btn');
        const instantPassBtn = document.getElementById('vc-instant-pass-btn');
        const endOffsetSlider = document.getElementById('vc-end-offset');
        const endOffsetVal = document.getElementById('vc-offset-val');
        const statusText = document.getElementById('vc-status');
        const headerDrag = document.getElementById('vc-header-drag');

        const showStatus = (msg, duration = 2500, color = '#00cec9') => {
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

        // Hızlı hız butonları
        document.querySelectorAll('.vc-speed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const speed = parseFloat(e.target.getAttribute('data-speed'));
                const video = getVideo();
                if (video) {
                    setSpeed(video, speed);
                    showStatus(`⚡ Oynatma hızı: ${speed}x yapıldı!`, 1500);
                } else {
                    showStatus('⚠️ Video bulunamadı!', 2000, '#ff7675');
                }
            });
        });

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

        // Doğrudan Geç Butonu
        instantPassBtn.addEventListener('click', async () => {
            showStatus('⚡ "Ctrl + Alt + ." gönderiliyor...', 1500, '#ffeaa7');
            await triggerCtrlAltDot();
            showStatus('✅ "Ctrl + Alt + ." basıldı!', 2500, '#55efc4');
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
                showStatus('⚠️ Video süresi henüz hazır değil, önce videoyu başlatın!', 3000, '#ff7675');
                return;
            }

            const offset = parseInt(endOffsetSlider.value, 10) || 2;
            const targetTime = Math.max(0, duration - offset);

            showStatus(`⏳ Son ${offset} sn'ye sarılıyor...`, 0, '#ffeaa7');

            // 1. Doğrudan ve zorlayıcı sarma
            forceSeek(video, targetTime);

            let attempts = 0;
            const seekLoop = setInterval(() => {
                forceSeek(video, targetTime);
                attempts++;
                if (video.currentTime >= targetTime - 1 || attempts >= 8) {
                    clearInterval(seekLoop);
                }
            }, 150);

            // 2. Eğer video doğrudan atlamadıysa 16x Turbo modunu hemen devreye sok
            setTimeout(() => {
                if (video.currentTime < targetTime - 3) {
                    showStatus('⚡ 16x Turbo Hız devrede...', 0, '#00cec9');
                    setSpeed(video, 16);
                }
            }, 800);

            // 3. Bitiş Kontrolü (Zaman aşımı korumalı)
            let checkTime = 0;
            const finishCheck = setInterval(async () => {
                checkTime += 250;
                const isFinished = (video.currentTime >= video.duration - Math.min(offset, 1.5)) || video.ended;

                // Eğer video sona ulaştıysa veya 6 saniye geçtiyse otomatik tetikle (Asla takılı kalmaz)
                if (isFinished || checkTime >= 6000) {
                    clearInterval(finishCheck);
                    clearInterval(seekLoop);

                    showStatus('⏳ Video bitti, tuşlanıyor...', 0, '#74b9ff');
                    await sleep(600);

                    await triggerCtrlAltDot();
                    showStatus('✅ "Ctrl + Alt + ." başarıyla basıldı!', 3500, '#55efc4');
                }
            }, 250);
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
                forceSeek(video, video.currentTime + skipSecs);
                break;
            case settings.backwardKey:
                forceSeek(video, Math.max(0, video.currentTime - skipSecs));
                break;
            case settings.speedUpKey:
                const newUp = Math.min(16, (video.playbackRate || 1) + 0.5);
                setSpeed(video, newUp);
                break;
            case settings.speedDownKey:
                const newDown = Math.max(0.25, (video.playbackRate || 1) - 0.25);
                setSpeed(video, newDown);
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