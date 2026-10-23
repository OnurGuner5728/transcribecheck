# TranscribeCheck

Whisper ile Türkçe seslendirme kalite kontrolü: referans metin ve ses karşılaştırması, eksik kelimelerin işaretlenmesi ve XML utterance etiketlerini koruyarak eksik bölümlerin dışa aktarılması.

## Canlı yayın

GitHub Pages etkinleşince: https://onurguner5728.github.io/transcribecheck/

## Kullanım

Web sitesinde transkripti yapıştırın veya TXT, XML, SRT dosyası / GitHub raw bağlantısı ekleyin. Ses dosyasını sürükleyip bırakın ya da doğrudan ses URL'si girin. Whisper Tiny, Base veya Small modeli seçip Analizi başlatın. Sonuçlardan eksik XML, CSV ve JSON indirebilirsiniz.

## Geliştirme

Node.js 22+:

```sh
npm install
npm test
npm run dev
npm run build
```

## Yayınlama

Repository Settings > Pages > Build and deployment > Source = GitHub Actions. `.github/workflows/pages.yml` dosyası otomatik test ve dağıtım gerçekleştirir.

## Önemli sınırlamalar

- Whisper bir konuşma tanıma modelidir, sonuçları kesin hüküm değildir. Özel isimlerde, sayılarda ve tekrar eden ifadelerde yanlış eşleştirme olabilir.
- Sadece utterance içerik metni karşılaştırılır; emotion, speaker, role ve voice_style yönergeleri seslendirilmesi beklenen sözlere dahil değildir.
- Kaynaktaki timestamp metadata olarak korunur; sesin kesin saniyesini göstermez.
- Model ilk kullanımda indirilir ve tarayıcı içinde çalışır. Ses bir uygulama sunucusuna yüklenmez.
- Uzak bağlantı CORS erişimi gerektirir. GitHub raw haricindeki sayfa URL'leri doğrudan ses olarak çalışmayabilir.
- Çok uzun seslerde bellek ihtiyacı artar; büyük modeller yavaş olabilir.

MIT lisansı ile dağıtılabilir.
