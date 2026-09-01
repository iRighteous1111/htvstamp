// ==UserScript==
// @name         EBA Video Kontrolcüsü & Otomatik Tamamlayıcı
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  EBA (eba.gov.tr) için video kontrolcüsü, son saniyelere sarma ve otomatik tuş tetikleyici (Ctrl + Alt + .)
// @match        *://*.eba.gov.tr/*
// @match        *://eba.gov.tr/*
// @grant        none
// @run-at       document-idle
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

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
    let settings = JSON.parse(localStorage.getItem('ebaVideoControllerSettings')) || defaultSettings;
    if (settings.endOffsetSec === undefined) settings.endOffsetSec = 2;

    // Yardımcı Gecikme (Sleep) Fonksiyonu
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Video Elementini Bulucu
    const getVideo = () => {
        return document.querySelector('video');
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
                target.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                target.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
                target.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
            }
        });
    }

    // --- GUI OLUŞTURMA (HTML & CSS) ---
    const guiHTML = `
        <div id="vc-gui-container" style="position: fixed; top: 20px; right: 20px; width: 310px; background: #1e1e24; color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; padding: 15px; z-index: 9999999; box-shadow: 0 8px 24px rgba(0,0,0,0.6); border: 1px solid #333; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 8px; margin-bottom: 12px;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                    <span>⚡</span> EBA Video Kontrol
                </h3>
                <button id="vc-toggle-btn" style="background: #2a2a35; border: 1px solid #444; color: #fff; cursor: pointer; font-size: 12px; border-radius: 4px; padding: 2px 8px;">➖</button>
            </div>
            
            <div id="vc-gui-content">
                <!-- Otomatik Sona Sar & Tuşla Bölümü -->
                <div style="background: #282834; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #3d3d50;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 500; font-size: 12px; color: #00d2d3;">Kalan Süre (Slider):</span>
                        <span id="vc-offset-val" style="font-weight: bold; color: #00d2d3; font-size: 13px;">${settings.endOffsetSec} sn</span>
                    </div>
                    <input type="range" id="vc-end-offset" min="1" max="30" step="1" value="${settings.endOffsetSec}" style="width: 100%; accent-color: #00d2d3; cursor: pointer; margin-bottom: 8px;">
                    
                    <button id="vc-skip-end-btn" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; box-shadow: 0 2px 8px rgba(0,206,201,0.3); transition: 0.2s;">
                        ⏩ Sona Sar & Bitince Tuşla (Ctrl+Alt+.)
                    </button>
                </div>

                <!-- Tuş Kısayolları Ayarları -->
                <div style="font-size: 11px; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Klavye Kısayolları</div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #bbb;">İleri Sar</label>
                        <input type="text" id="vc-fwd-key" value="${settings.forwardKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #282834; color: #fff; border: 1px solid #444; text-align: center; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #bbb;">Geri Sar</label>
                        <input type="text" id="vc-bwd-key" value="${settings.backwardKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #282834; color: #fff; border: 1px solid #444; text-align: center; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #bbb;">Hızlandır</label>
                        <input type="text" id="vc-sup-key" value="${settings.speedUpKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #282834; color: #fff; border: 1px solid #444; text-align: center; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #bbb;">Yavaşlat</label>
                        <input type="text" id="vc-sdwn-key" value="${settings.speedDownKey}" maxlength="1" style="width: 100%; padding: 5px; box-sizing: border-box; background: #282834; color: #fff; border: 1px solid #444; text-align: center; border-radius: 4px;">
                    </div>
                    <div style="grid-column: span 2;">
                        <label style="font-size: 11px; display: block; margin-bottom: 3px; color: #bbb;">Atlama Miktarı (Saniye)</label>
                        <input type="number" id="vc-skip-time" value="${settings.skipTime}" style="width: 100%; padding: 5px; box-sizing: border-box; background: #282834; color: #fff; border: 1px solid #444; border-radius: 4px;">
                    </div>
                </div>
                
                <button id="vc-save-btn" style="width: 100%; padding: 7px; background: #4a4b5f; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 500; font-size: 12px; transition: 0.2s;">
                    💾 Ayarları Kaydet
                </button>
                <div id="vc-status" style="font-size: 11px; color: #00cec9; text-align: center; margin-top: 8px; display: none; line-height: 1.4;"></div>
            </div>
        </div>
    `;

    // Arayüzü Sayfaya Ekle
    const guiWrapper = document.createElement('div');
    guiWrapper.innerHTML = guiHTML;
    document.body.appendChild(guiWrapper);

    // --- GUI ELEMENTLERİ ---
    const container = document.getElementById('vc-gui-container');
    const content = document.getElementById('vc-gui-content');
    const toggleBtn = document.getElementById('vc-toggle-btn');
    const saveBtn = document.getElementById('vc-save-btn');
    const skipEndBtn = document.getElementById('vc-skip-end-btn');
    const endOffsetSlider = document.getElementById('vc-end-offset');
    const endOffsetVal = document.getElementById('vc-offset-val');
    const statusText = document.getElementById('vc-status');

    const showStatus = (msg, duration = 2500, color = '#00cec9') => {
        statusText.textContent = msg;
        statusText.style.color = color;
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

    // Panele tıklanırken/yazarken video kısayollarını engelle
    container.addEventListener('keydown', (e) => e.stopPropagation());

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

        localStorage.setItem('ebaVideoControllerSettings', JSON.stringify(settings));
        showStatus('✅ Ayarlar Kaydedildi!', 2000, '#00b894');
    });

    // --- SONA SAR VE BİTİNCE TETİKLE MANTIĞI ---
    skipEndBtn.addEventListener('click', async () => {
        const video = getVideo();
        if (!video) {
            showStatus('⚠️ Sayfada video bulunamadı!', 3000, '#ff7675');
            return;
        }

        if (isNaN(video.duration) || video.duration <= 0) {
            showStatus('⚠️ Video süresi henüz yüklenmedi, videoyu başlatın!', 3000, '#ff7675');
            return;
        }

        const offset = parseInt(endOffsetSlider.value, 10) || 2;
        const targetTime = Math.max(0, video.duration - offset);
        
        video.currentTime = targetTime;
        
        // Eğer duraklatılmışsa oynat
        if (video.paused) {
            try {
                await video.play();
            } catch (err) {
                console.log('Otomatik oynatma izni bekleniyor:', err);
            }
        }

        showStatus(`⏳ Son ${offset} sn'ye sarıldı, video bitişi bekleniyor...`, 0, '#ffeaa7');

        let handled = false;
        const completeAction = async () => {
            if (handled) return;
            handled = true;

            // Event listener'ları temizle
            video.removeEventListener('ended', completeAction);
            video.removeEventListener('pause', onPauseCheck);
            video.removeEventListener('timeupdate', onTimeUpdateCheck);

            showStatus('⏳ Video bitti. Bekleniyor...', 0, '#74b9ff');
            await sleep(800); // Doğal sleep gecikmesi

            // "Ctrl + Alt + ." tuş kombinasyonunu bas
            await triggerCtrlAltDot();

            showStatus('✅ "Ctrl + Alt + ." başarıyla tetiklendi!', 4000, '#55efc4');
        };

        const onPauseCheck = () => {
            // Eğer video neredeyse bitmişken durduysa
            if (video.currentTime >= video.duration - 0.5 || video.ended) {
                completeAction();
            }
        };

        const onTimeUpdateCheck = () => {
            // Video sona ulaştığında veya çok yaklaştığında
            if (video.currentTime >= video.duration - 0.2 || video.ended) {
                completeAction();
            }
        };

        video.addEventListener('ended', completeAction, { once: true });
        video.addEventListener('pause', onPauseCheck);
        video.addEventListener('timeupdate', onTimeUpdateCheck);
    });

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