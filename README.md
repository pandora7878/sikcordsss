# Sikcordsss

Modern görünümlü, gerçek zamanlı sesli ve yazılı sohbet uygulaması + gelişmiş yönetim paneli.

## Özellikler
- Kayıt / giriş (JWT)
- Arkadaş arama ve arkadaşlık isteği
- Grup oluşturma ve grup sohbeti
- Gerçek zamanlı özel mesajlaşma (Socket.IO)
- Resim gönderme (upload)
- WebRTC tabanlı sesli oda (basit signaling)
- Admin paneli: kullanıcılar, e-posta, son IP, parola hash, istatistikler

## Kurulum
```bash
npm install
npm start
```

Sonra `http://localhost:3000` açın.

Varsayılan admin hesabı:
- kullanıcı adı: `admin`
- e-posta: `admin@local.dev`
- şifre: `admin123`

## Not
Parolalar düz metin tutulmaz, bcrypt hash olarak saklanır.
