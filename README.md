# Sikcord (Discord-Style Advanced Build)

Bu sürüm, önceki prototipten daha gelişmiş bir **Discord-benzeri düzen** ile güncellendi.

## Öne çıkan geliştirmeler

- Sol tarafta sunucu/grup kolon yapısı
- Gruplarım sidebar listesi
- Arkadaşlar (DM) sidebar listesi
- Grup içi kanal benzeri mesajlaşma alanı
- Arkadaşlarla direkt mesajlaşma (DM)
- Tek tıkla grup oluşturma (modal)
- Dashboard + Admin paneli
- Aktivite akışı, duyurular, metrikler

## Kurulum

```bash
npm start
```

Uygulama: `http://localhost:3000`

## Varsayılan admin

- Email: `admin@sikcord.local`
- Şifre: `Admin123!`

Değiştirmek için:

```bash
ADMIN_EMAIL=owner@sikcord.com ADMIN_PASSWORD='StrongPass!123' npm start
```


## Vercel Deploy

Bu proje artık Vercel üzerinde de çalışacak şekilde düzenlendi:

- `api/index.js` serverless giriş noktası
- `vercel.json` ile tüm istekler API handler'a yönlenir
- Vercel ortamında veri dosyası `/tmp/data.json` kullanılır

Deploy adımları:

```bash
vercel
```

> Not: `/tmp` Vercel'de kalıcı değildir. Yani yeniden deploy/ölçeklemede veriler sıfırlanabilir. Kalıcı kullanım için Vercel KV / harici DB önerilir.
