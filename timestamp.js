// ==UserScript==
// @name         EBA Video Kontrolcüsü & Otomatik Tamamlayıcı
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  EBA (eba.gov.tr & meb.gov.tr) için video kontrolcüsü, son saniyelere sarma ve otomatik tuş tetikleyici (Ctrl + Alt + .)
// @match        *://*.eba.gov.tr/*
// @match        *://eba.gov.tr/*
// @match        *://*.meb.gov.tr/*
// @match        *://meb.gov.tr/*
// @include      *://*eba.gov.tr/*
// @include      *://*meb.gov.tr/*
// @include      *eba.gov.tr*
// @include      *meb.gov.tr*
// @grant        none
// @run-at       document-start
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    // Sadece üst pencerede veya video içeren çerçevelerde GUI oluştur
    const isTopWindow = (window.self === window.top);

    // Varsayılan Ayarlar
    const defaultSettings = {
        forwardKey: 'l',
        backwardKey: 'j',
        speedUpKey: 'h',
        speedDownKey: 'g',
        skipTime: 10,
        endOffsetSec: 2 // Videonun bitimine kaç saniye kala sarılacak
    };

    // Ayarları LocalStorage'dan Yükle
    let settings = defaultSettings;
    try {
        const saved = localStorage.getItem('ebaVideoControllerSettings');
        if (saved) settings = Object.assign({}, defaultSettings, JSON.parse(saved));
    } catch(e) {
        console.warn('LocalStorage erişim hatası:', e);
    }

    // Yardımcı Gecikme (Sleep) Fonksiyonu
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Video Elementini Bulucu (Sayfa ve iframeler içinde arar)
    const getVideo = () => {
        let video = document.querySelector('video');
        if (video) return video;

        // Sayfa içindeki erişilebilir iframe'leri kontrol et
        const iframes = document.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
            try {
                const frameDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                if (frameDoc) {
                    const v = frameDoc.querySelector('video');
                    if (v) return v;
                }
            } catch (err) {
                // Cross-origin iframe olabilir, @allFrames zaten orada çalışacaktır
            }
        }
        return null;
    };

    // "Ctrl + Alt + ." Tuş Kombinasyonunu Simüle Eden Fonksiyon
    async function triggerCtrlAltDot() {
        await sleep(600); // İşlem öncesi doğal bekleme süresi

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
        targets.forEach(target => {
            if (target) {
                try {
                    target.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
                    target.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                } catch(e) {}
            }
        });
    }

    // --- GUI OLUŞTURMA VE YÖNETME ---
    function createGUI() {
        if (document.getElementById('vc-gui-container')) return;
        if (!document.body) return;

        const guiHTML = `
            <div id="vc-gui-container" style="position: fixed; top: 30px; right: 30px; width: 310px; background: #181920; color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 12px; padding: 14px; z-index: 2147483647; box-shadow: 0 10px 30px rgba(0,0,0,0.7); border: 1px solid #333644; font-size: 13px; user-select: none;">
                <!-- Başlık & Sürükleme Barı -->
                <div id="vc-header-drag" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #2e303e; padding-bottom: 8px; margin-bottom: 12px; cursor: move;">
                    <h3 style="margin: 0; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; color: #00cec9; pointer-events: none;">
                        <span>⚡</span> EBA Video Asistanı
                    </h3>
                    <button id="vc-toggle-btn" style="background: #252733; border: 1px solid #444; color: #fff; cursor: pointer; font-size: 12px; border-radius: 6px; padding: 2px 8px; transition: 0.2s;">➖</button>
                </div>
                
                <div id="vc-gui-content">
                    <!-- Otomatik Sona Sar & Tuşla Bölümü -->
                    <div style="background: #222430; padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #36394a;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="font-weight: 500; font-size: 12px; color: #00d2d3;">Kalan Süre (Bitişe kala):</span>
                            <span id="vc-offset-val" style="font-weight: 700; color: #00d2d3; font-size: 13px;">${settings.endOffsetSec} sn</span>
                        </div>
                        <input type="range" id="vc-end-offset" min="1" max="30" step="1" value="${settings.endOffsetSec}" style="width: 100%; accent-color: #00d2d3; cursor: pointer; margin-bottom: 10px;">
                        
                        <button id="vc-skip-end-btn" style="width: 100%; padding: 9px; background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 12px; box-shadow: 0 4px 12px rgba(0,206,201,0.25); transition: 0.2s;">
                            ⏩ Sona Sar & Bitince Tuşla (Ctrl+Alt+.)
                        </button>
                    </div>

                    <!-- Tuş Kısayolları Ayarları -->
                    <div style="font-size: 11px; color: #7f8fa6; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Klavye Kısayolları</div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                        <div>
                            <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #a4b0be;">İleri Sar</label>
                            <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #222430; color: #fff; border: 1px solid #3c4052; text-align: center; border-radius: 4px; outline: none;">
                        </div>
                        <div>
                            <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #a4b0be;">Geri Sar</label>
                            <input type="text" id="vc-bwd-key" value="${settings.backwardKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #222430; color: #fff; border: 1px solid #3c4052; text-align: center; border-radius: 4px; outline: none;">
                        </div>
                        <div>
                            <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #a4b0be;">Hızlandır</label>
                            <input type="text" id="vc-sup-key" value="${settings.speedUpKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #222430; color: #fff; border: 1px solid #3c4052; text-align: center; border-radius: 4px; outline: none;">
                        </div>
                        <div>
                            <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #a4b0be;">Yavaşlat</label>
                            <input type="text" id="vc-sdwn-key" value="${settings.speedDownKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #222430; color: #fff; border: 1px solid #3c4052; text-align: center; border-radius: 4px; outline: none;">
                        </div>
                        <div style="grid-column: span 2;">
                            <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #a4b0be;">Atlama Miktarı (Saniye)</label>
                            <input type="number" id="vc-skip-time" value="${settings.skipTime}" style="width: 100%; padding: 5px; box-sizing: border-box; background: #222430; color: #fff; border: 1px solid #3c4052; border-radius: 4px; outline: none;">
                        </div>
                    </div>
                    
                    <button id="vc-save-btn" style="width: 100%; padding: 8px; background: #353b48; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: 0.2s;">
                        💾 Ayarları Kaydet
                    </button>
                    <div id="vc-status" style="font-size: 11px; color: #00cec9; text-align: center; margin-top: 8px; display: none; line-height: 1.4; padding: 4px; border-radius: 4px;"></div>
                </div>
            </div>
        `;

        const guiWrapper = document.createElement('div');
        guiWrapper.id = 'vc-wrapper';
        guiWrapper.innerHTML = guiHTML;
        document.body.appendChild(guiWrapper);

        // --- GUI ELEMENTLERİ & ETKİLEŞİM ---
        const container = document.getElementById('vc-gui-container');
        const content = document.getElementById('vc-gui-content');
        const toggleBtn = document.getElementById('vc-toggle-btn');
        const saveBtn = document.getElementById('vc-save-btn');
        const skipEndBtn = document.getElementById('vc-skip-end-btn');
        const endOffsetSlider = document.getElementById('vc-end-offset');
        const endOffsetVal = document.getElementById('vc-offset-val');
        const statusText = document.getElementById('vc-status');
        const headerDrag = document.getElementById('vc-header-drag');

        const showStatus = (msg, duration = 2500, color = '#00cec9', bg = 'rgba(0, 206, 201, 0.1)') => {
            statusText.textContent = msg;
            statusText.style.color = color;
            statusText.style.background = bg;
            statusText.style.display = 'block';
            if (duration > 0) {
                setTimeout(() => {
                    statusText.style.display = 'none';
                }, duration);
            }
        };

        // Slider Değeri Değişimi
        endOffsetSlider.addEventListener('input', (e) => {
            endOffsetVal.textContent = `${e.target.value} sn`;
            settings.endOffsetSec = parseInt(e.target.value, 10);
        });

        // Tuş yazarken video kısayollarını engelle
        container.addEventListener('keydown', (e) => e.stopPropagation());

        // Sürükle Bırak (Draggable) Özelliği
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

        // Paneli Küçült / Büyüt
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
                localStorage.setItem('ebaVideoControllerSettings', JSON.stringify(settings));
            } catch(e) {}
            showStatus('✅ Ayarlar Kaydedildi!', 2000, '#00b894', 'rgba(0, 184, 148, 0.15)');
        });

        // --- SONA SAR VE BİTİNCE TETİKLE MANTIĞI ---
        skipEndBtn.addEventListener('click', async () => {
            const video = getVideo();
            if (!video) {
                showStatus('⚠️ Sayfada video bulunamadı!', 3000, '#ff7675', 'rgba(255, 118, 117, 0.15)');
                return;
            }

            if (isNaN(video.duration) || video.duration <= 0) {
                showStatus('⚠️ Video henüz başlatılmadı veya süresi alınamadı!', 3000, '#ff7675', 'rgba(255, 118, 117, 0.15)');
                return;
            }

            const offset = parseInt(endOffsetSlider.value, 10) || 2;
            const targetTime = Math.max(0, video.duration - offset);
            
            video.currentTime = targetTime;
            
            // Eğer duraklatılmışsa otomatik oynat
            if (video.paused) {
                try {
                    await video.play();
                } catch (err) {
                    console.log('Video otomatik oynatılamadı, lütfen oynata basın:', err);
                }
            }

            showStatus(`⏳ Son ${offset} sn'ye sarıldı, video bitişi bekleniyor...`, 0, '#ffeaa7', 'rgba(255, 234, 167, 0.15)');

            let handled = false;
            const completeAction = async () => {
                if (handled) return;
                handled = true;

                // Event listener'ları temizle
                video.removeEventListener('ended', completeAction);
                video.removeEventListener('pause', onPauseCheck);
                video.removeEventListener('timeupdate', onTimeUpdateCheck);

                showStatus('⏳ Video tamamlandı, bekleniyor...', 0, '#74b9ff', 'rgba(116, 185, 255, 0.15)');
                await sleep(800); // Doğal gecikme

                // "Ctrl + Alt + ." tuş kombinasyonunu bas
                await triggerCtrlAltDot();

                showStatus('✅ "Ctrl + Alt + ." başarıyla tetiklendi!', 4000, '#55efc4', 'rgba(85, 239, 196, 0.15)');
            };

            const onPauseCheck = () => {
                if (video.currentTime >= video.duration - 0.5 || video.ended) {
                    completeAction();
                }
            };

            const onTimeUpdateCheck = () => {
                if (video.currentTime >= video.duration - 0.2 || video.ended) {
                    completeAction();
                }
            };

            video.addEventListener('ended', completeAction, { once: true });
            video.addEventListener('pause', onPauseCheck);
            video.addEventListener('timeupdate', onTimeUpdateCheck);
        });
    }

    // --- SAYFA VE SPA YÜKLEME KONTROLLERİ ---
    // DOM hazır olduğunda veya SPA sayfa geçişlerinde GUI'yi koru
    const initInterval = setInterval(() => {
        if (document.body) {
            createGUI();
            // Eğer GUI oluşturulduysa interval'i yavaşlat/kontrol et
            if (document.getElementById('vc-gui-container')) {
                // SPA kontrolleri için periyodik hafif kontrol
            }
        }
    }, 500);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createGUI);
    } else {
        createGUI();
    }

    // --- KLAVYE KONTROL DİNLEYİCİSİ ---
    document.addEventListener('keydown', function(e) {
        // Form öğelerindeyken kısayolları çalıştırma
        const activeTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || e.target.isContentEditable) return;

        const video = getVideo();
        if (!video) return;

        const key = e.key.toLowerCase();
        const skipSecs = settings.skipTime;

        switch(key) {
            case settings.forwardKey:
                video.currentTime += skipSecs;
                break;
            case settings.backwardKey:
                video.currentTime -= skipSecs;
                break;
            case settings.speedUpKey:
                video.playbackRate += 0.25;
                break;
            case settings.speedDownKey:
                video.playbackRate = Math.max(0.25, video.playbackRate - 0.25);
                break;
        }
    }, true); // Capture mode ile site engellemelerini aş
})();