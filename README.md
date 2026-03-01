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

Bu repo artık Vercel için hazır:

- `vercel.json` ile route/build ayarları tanımlı.
- `api/index.js` serverless entrypoint olarak çalışır.
- Vercel ortamında dosya sistemi kalıcı olmadığı için veriler **memory** üzerinde tutulur (deploy/restart sonrası sıfırlanır).

Vercel'de kalıcı veri istiyorsan bir dış veritabanı (Neon/Supabase/Mongo) bağlamalısın.
