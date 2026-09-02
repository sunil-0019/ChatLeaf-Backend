# ChatLeaf Backend v2 (Email+Password Login, Google Login, OTP Rules)

## 1. Setup

```bash
cd chatleaf-backend
npm install
cp .env.example .env
```

`.env` fill karo:
- `MONGO_URI` — MongoDB Atlas connection string
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — do alag lambe random strings
- `EMAIL_USER`, `EMAIL_PASS` — Gmail + App Password
- `GOOGLE_CLIENT_ID` — Google Cloud Console se (neeche steps hain)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — [cloudinary.com](https://cloudinary.com) par free account banao, Dashboard par yeh teeno mil jayenge (profile photo upload ke liye zaroori hai)

```bash
npm run dev
```

## 2. Google Sign-In Setup (Android side)

1. [Google Cloud Console](https://console.cloud.google.com) me project banao
2. "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth Client ID"
3. **Do client IDs banane padenge:**
   - Type: **Android** — apna package name aur SHA-1 fingerprint dena hoga
   - Type: **Web application** — iska Client ID `.env` me `GOOGLE_CLIENT_ID` me daalna hai (backend isi se verify karta hai)
4. Android app me Google Sign-In SDK use karke `idToken` lo, usko backend ke `/api/auth/google-login` pe bhejo

## 2.5. Website Setup (Terms, Privacy, Contact, App Info, Reset-Password page)

Backend `/public` folder se ek poori website bhi serve karta hai — yeh sirf **browser me kholne ke liye** hai, Android app iska use nahi karta (app sirf `/api/auth/*` JSON endpoints use karta hai).

**Pages jo already ban chuki hain:**
- `/index.html` — Homepage
- `/terms.html` — Terms & Conditions
- `/privacy.html` — Privacy Policy
- `/app-info.html` — App ke baare me jaankari (screenshots/download-link daalne ke liye placeholder hai)
- `/contact.html` — Contact form (email, phone, message) — submit hote hi tumhare `DEVELOPER_CONTACT_EMAIL` pe mail jaati hai
- `/reset-password.html` — Password-reset link is page ko kholता hai (Settings ke "forgot password" flow ke liye, neeche section 3.5 dekho)

**Tumhe khud karna hai:**
1. `.env` me `DEVELOPER_CONTACT_EMAIL=youremail@gmail.com` daalna — contact-form ke messages yahi aayenge
2. `.env` me `APP_BASE_URL=https://your-hosted-domain.com` daalna (jab website host kar do) — warna reset-password links request-URL se apne aap ban jayenge, lekin production me apna asli domain daalna better hai
3. `public/app-info.html` file kholke apne screenshots/Play-Store-link daalna — file ke andar clear comments hain kaha kya daalna hai (`<img src="/your-image.png">` jaisa)
4. `public/contact.html` file kholke apna phone number aur email update karna — `id="contact-phone"` aur `id="contact-email"` dhundo
5. Apne screenshots/images `public/` folder me daal dena, phir unhe HTML me filename se reference kar dena

**Note:** Contact form sirf text (email, phone, message) accept karta hai — photo/PDF attachment support nahi hai. Agar koi image bhejni ho, wo tumhare `DEVELOPER_CONTACT_EMAIL` pe seedha reply karke bhej sakta hai.

## 3. Saare Endpoints

### Signup (sirf Full Name + Email — password backend khud banata hai)
```
POST /api/auth/signup/send-otp
Body: { "fullName": "Sunil Pal", "email": "sunil@gmail.com" }
→ Email pe OTP jata hai. Password abhi nahi banta - yeh sirf OTP verify hone ke baad banega.

POST /api/auth/signup/verify-otp
Body: { "email": "sunil@gmail.com", "otp": "482170", "deviceId": "abc-123", "deviceName": "Pixel 7" }
→ OTP sahi hote hi account create ho jata hai:
   - Backend khud ek 12-character password generate karta hai (naam + digits + symbol)
   - Default avatar generate hota hai — naam ka SIRF PEHLA LETTER (jaise "Sunil Pal" -> "S") + ek random background color (har user ko alag color milta hai, naam se koi lena-dena nahi, ek baar assign hone ke baad hamesha wahi rehta hai)
   - Unique userId (jaise "sunil_4821") generate hota hai
   - Welcome email jaati hai jisme userId + password dono hote hain
   - Response me accessToken, refreshToken, user milta hai
   - Agar welcome email fail ho jaye (SMTP issue), response me "temporaryPassword" field
     bhi aata hai taaki user apna password dekh sake bina email ke

POST /api/auth/signup/resend-otp
Body: { "email": "sunil@gmail.com" }
```

### Login (Email + Password)
```
POST /api/auth/login
Body: { "email": "sunil@gmail.com", "password": "abc12345", "deviceId": "abc-123", "deviceName": "Pixel 7" }
→ Email exist nahi -> "Email not exist."
→ Password galat -> "Incorrect password."
→ Naya device ho -> security email trigger hoti hai automatically
```

### Google Login (login + auto-signup dono isi ek endpoint se)
```
POST /api/auth/google-login
Body: { "idToken": "<Google se mila ID token>", "deviceId": "abc-123", "deviceName": "Pixel 7" }
→ Email pehle se hai -> seedha login (koi OTP nahi)
→ Email nahi hai -> naya account auto-create, backend password bhi generate karta hai
   (isse baad me simple email+password se bhi login ho sakta hai), welcome email jati hai
```

### Forgot Password → Naya Password Generate + Auto-Login
```
POST /api/auth/forgot-password/send-otp
Body: { "email": "sunil@gmail.com" }
→ Email exist nahi -> "Email not exist."

POST /api/auth/forgot-password/verify-otp
Body: { "email": "sunil@gmail.com", "otp": "482170", "deviceId": "abc-123", "deviceName": "Pixel 7" }
→ OTP sahi hote hi:
   - Ek NAYA password backend generate karta hai (purana password wapas nahi mil sakta,
     woh sirf hashed form me store hota hai)
   - Naya password sirf EMAIL par bheja jata hai (response me kabhi nahi dikhta)
   - User turant automatically login ho jata hai (accessToken + refreshToken milta hai)
   - Agar email fail ho jaye, tabhi fallback ke taur par "temporaryPassword" response me aata hai

POST /api/auth/forgot-password/resend-otp
Body: { "email": "sunil@gmail.com" }
```

### Token Refresh (access token 15 min me expire hota hai, refresh token PERMANENT hai)
```
POST /api/auth/refresh-token
Body: { "refreshToken": "<pehle mila refresh token>" }
→ Sirf NAYA accessToken milta hai. refreshToken WAHI PURANA rehta hai — yeh sirf
  LOGOUT karne par hi invalidate hota hai, dobara login karne par hi naya banta hai.
```

### Logout
```
POST /api/auth/logout
Header: Authorization: Bearer <accessToken>
→ Refresh token yahi se invalidate hota hai (DB se hash hata diya jata hai)
```

### Profile (future Settings screen ke liye — login required)
```
PATCH /api/auth/profile/user-id
Header: Authorization: Bearer <accessToken>
Body: { "newUserId": "sunil@official_123" }
→ Length 8-30 characters, sirf lowercase letters/numbers/underscore/@ (koi aur symbol nahi)
→ Pehli baar edit karne pe koi cooldown nahi. Uske baad 30 din me sirf ek baar badal sakte ho
  (edit karte hi 30-din ka naya timer shuru ho jata hai)
→ Naya userId pehle se kisi aur ka toh nahi, check hota hai
→ Email notification jati hai (purana + naya userId dikhaते hue)

PATCH /api/auth/profile/password
Header: Authorization: Bearer <accessToken>
Body: { "currentPassword": "old123", "newPassword": "new456ab", "confirmNewPassword": "new456ab" }
→ Yeh tab use hota hai jab user ko APNA CURRENT password yaad hai aur khud badalna chahta hai
→ Email notification jati hai ("password change hua" - naya password email me NAHI jata,
  kyuki user ne khud type kiya tha, usko pehle se pata hai)
→ NOTE: agar current password yaad NAHI hai, toh yeh endpoint nahi — neeche wala
  "Profile Forgot Password" flow use karo (LINK-based, session change NAHI hota)

PATCH /api/auth/profile
Header: Authorization: Bearer <accessToken>
Body: { "fullName": "Sunil Kumar Pal", "about": "Living my best life" }
→ "fullName" aur "about" dono ya inme se koi ek bhej sakte ho. Koi email nahi jati
  (jaisa maanga gaya tha — sirf userId/password change email bhejte hain)

POST /api/auth/profile/picture
Header: Authorization: Bearer <accessToken>
Body: multipart/form-data, field name "profileImage" (ek image file - JPG/PNG/WEBP, max 5MB)
→ Image Cloudinary par upload hoti hai, MongoDB me sirf Cloudinary ka URL (chhota string)
  save hota hai — actual photo file kabhi MongoDB me nahi jaati
→ Purani photo (agar Cloudinary-hosted thi) background me delete ho jati hai
→ Koi email nahi jati
```

### Profile "Forgot Password" — Current Password Yaad Nahi (LINK-based, session change NAHI hota)

**Yeh Login-screen wale "Forgot Password" (OTP-based) se BILKUL ALAG hai.** Yeh tab use
hota hai jab user **already app ke andar logged in hai** (Settings me hai) aur sirf apna
current password bhool gaya hai. Isme koi naya login-session nahi banta — user apne
existing session me hi rehta hai, sirf password badalta hai.

```
POST /api/auth/profile/password/request-reset-link
Header: Authorization: Bearer <accessToken>   (LOGIN REQUIRED)
→ Email par ek SECURE LINK jata hai (OTP nahi). Response me koi token nahi milta.
→ 1 din (24 ghante) me max 2 baar hi link mangwa sakte ho — is se zyada try karne par
  "Too many requests" error milta hai
→ Naya link maangte hi purana (agar tha) automatically invalid ho jata hai

GET /api/auth/profile/password/validate-reset-link?token=xxx   (PUBLIC - login required nahi)
→ Web-page (reset-password.html) load hote hi yeh call hota hai, check karta hai link
  abhi valid hai ya nahi (5 min ke andar hai, already used toh nahi, exist karta hai)

POST /api/auth/profile/password/reset-via-link   (PUBLIC - login required nahi)
Body: { "token": "xxx", "newPassword": "new456ab", "confirmNewPassword": "new456ab" }
→ Password update ho jata hai. Response me koi access/refresh token NAHI milta -
  user ka existing app session bilkul waisa hi chalta rehta hai jaisa pehle tha
→ Confirmation email jati hai ("password change hua")
```

**Link ke rules:**
- Link **5 minute** tak valid rehta hai
- Link **sirf ek baar** use ho sakta hai — dobara try karne pe "already used" error (race-condition-safe: 2 baar ek saath submit karne pe bhi sirf ek hi safal hoti hai)
- Agar link kabhi khola hi na jaye, **10 minute** me safety-net TTL se database se apne aap delete ho jata hai
- **1 din me max 2 requests** — login-flow ke OTP rules (5-attempt/24hr) se bilkul alag, zyada strict rule hai yeh
- Link kholne pe ek web-page (`/reset-password.html`) khulta hai jisme "New Password" + "Confirm Password" do fields hain — dono match hone chahiye, tabhi submit hota hai

### Website Contact Form
```
POST /api/public/contact
Body: { "email": "user@example.com", "phone": "+919876543210", "message": "Hello, I have a question..." }
→ Tumhare DEVELOPER_CONTACT_EMAIL par email jati hai (Reply-To user ka email set hota hai,
  taaki tum seedha "Reply" dabake unhe jawab de sako)
→ Yeh sirf website (public/contact.html) use karta hai, Android app nahi
```

## 4. OTP Rules (Signup aur Forgot-Password DONO me same rule)

- OTP **5 minute** tak valid rehta hai (isi window ke andar verify karna hoga)
- Naya OTP maangne (resend) ke beech **2 minute ka gap** zaroori hai
- 24 ghante ke andar **max 5 baar** OTP maang sakte ho
- 5 se zyada baar maangne par **24 ghante ka lock** lagta hai
- 24 ghante baad counter khud reset ho jata hai
- **Important fix:** lock lagne ke baad bhi record 24-hour tak database me zinda rehta hai (safety-net TTL sirf tab 10-min hoti hai jab window fresh/naya ho) — isse "lock lagne ke thodi der baad naya OTP mil jaana" wala bug nahi hota

## 5. Storage cleanup — MongoDB me sirf User collection permanent rehti hai

`Otp` collection **temporary** hai, permanent User data se bilkul alag rakha gaya hai:

- OTP record **turant delete** ho jata hai jaise hi verify ho jaye (signup complete ho, ya forgot-password se login ho jaye) — `Otp.deleteOne()` code me
- Agar user pehli baar hi OTP maang ke beech me chhod de (kabhi verify na kare, kabhi resend na kare) — safety-net ke taur par **10 minute** baad MongoDB ka **TTL index** khud us record ko delete kar deta hai
- Agar user 24-hour ki attempt-window ke andar hai (chahe locked ho ya nahi), record **poore 24 ghante tak zinda rehta hai** — taaki lock kabhi silently bypass na ho
- Matlab: `Otp` collection me kabhi purana/bekar data jama nahi hota, sirf active OTP attempts hi dikhte hain
- **Sirf `User` collection permanently store hoti hai** — naam, email, hashed password, userId, about, profile — yehi asli app data hai

## 6. Security Design

- **Passwords**: bcrypt se hash, kabhi plain text store/return nahi hote. Signup ke waqt (email/OTP ho ya Google se) backend khud generate karta hai — user kabhi khud password type nahi karta signup ke time.
- **Tokens**: Access token (15 min, expire hota hai) + Refresh token (**permanent**, koi expiry nahi). Refresh token sirf tab invalidate hota hai jab user **LOGOUT** kare — `/refresh-token` call karne se refresh token badalta NAHI, sirf naya access token milta hai. Refresh token DB me hashed store hota hai — agar DB leak bhi ho, tokens use nahi ho sakte.
- **User ID**: readable format (`sunil_4821`), length 8-30 characters, phone number ki jagah chat/profile me dikhega, 30-din cooldown ke sath edit ho sakta hai (edit karte hi naya 30-din timer shuru hota hai)
- **Naya device detect**: login/signup pe `deviceId` bhejna hoga (Android ANDROID_ID ya generated UUID use karo) — naya device pe security email jaati hai
- **Rate limiting**: auth endpoints par 15 min me max 30 requests/IP — spam/brute-force se bachne ke liye
- **Crash-proofing**: har controller try-catch me, global error handler, `unhandledRejection`/`uncaughtException` bhi catch
- **Forgot password ≠ Change password**: dono alag concept hain — Change Password (Settings me current password se) sirf notification email bhejta hai; Forgot Password (current yaad nahi) naya password generate karke poora password hi email karta hai
- **Access tokens ke type-check**: har protected route access-token ko `type: "access"` field se verify karta hai, aur refresh-endpoint refresh-token ko `type: "refresh"` se — isse ek token doosri jagah use nahi ho sakta, chahe kisi galti se secrets match bhi ho jayein
- **Profile photo upload**: sirf JPG/PNG/WEBP allowed, max 5MB, sirf logged-in user apni khud ki photo upload kar sakta hai (`protect` middleware route se pehle lagi hai). File kabhi disk pe nahi likhi jati (memory se seedha Cloudinary), aur MongoDB me sirf URL string store hoti hai

## 7. Email Notifications (kab-kab jaati hain)

| Event | Email jaati hai? |
|---|---|
| Signup success (email/OTP ya Google) | ✅ Welcome email (userId + password ke sath) |
| Naya device se login | ✅ Security alert |
| Forgot Password (naya password generate) | ✅ Naya password poora email me jata hai |
| User ID change | ✅ Notification (naya userId dikhाते hue) |
| Password change (Settings se, current password se) | ✅ Notification (sirf confirmation, naya password email me NAHI jata) |
| About/Profile picture update | ❌ Nahi jaati (jaisa maanga gaya) |

## 8. Android Integration Notes

- Har login/signup/OTP-verify call me `deviceId` aur `deviceName` bhejna — naya-device detection isi se kaam karta hai
- `accessToken` ko har protected API call me `Authorization: Bearer <token>` header me bhejna
- `accessToken` 15 min me expire ho jayega — 401 aane par `refreshToken` se naya lo, phir wahi request retry karo
- `refreshToken` ko SharedPreferences me secure jagah save karo (ya EncryptedSharedPreferences use karo aur behtar security ke liye)

## 9. Debugging — agar Email nahi ja rahi ho

Yeh sabse common issue hoti hai. Terminal me server console dekho — ab exact wajah print hogi:

- **"Email is not configured. Missing .env values: ..."** → `.env` file me EMAIL_HOST/EMAIL_PORT/EMAIL_USER/EMAIL_PASS/EMAIL_FROM me se koi field khali hai ya `.env` load hi nahi hui (check karo `.env` file `chatleaf-backend` folder ke root me hai, `.env.example` ki jagah `.env` naam se)
- **"Invalid login" ya "535 Authentication failed"** → Gmail normal password kaam nahi karega. Google Account → Security → 2-Step Verification ON karo, fir "App Passwords" se 16-digit password banao, wahi `EMAIL_PASS` me daalo
- **"self signed certificate" ya connection timeout** → `EMAIL_PORT=465` ke sath `secure: true` hona chahiye (code me already hai) - agar `587` use kar rahe ho toh `secure: false` hona chahiye
- Har device-related security email (naya-device login) **sirf tab jaati hai jab woh device pehli baar dekha ja raha ho** — agar tum baar-baar same `deviceId` bhej rahe ho, doosri baar email nahi aayegi (yeh normal hai). Testing ke liye har baar alag `deviceId` bhejo, ya user ka `knownDevices` array DB se manually clear karo
- **Kabhi-kabhi email na aana (intermittent)** → Gmail jaise free SMTP providers kabhi-kabhi temporary connection issues dete hain. Ab email bhejne me automatic **retry** hai (2 attempts tak, 1 second delay ke sath) — isse zyada tar transient failures khud resolve ho jaate hain. Agar phir bhi fail ho, console me poora error dikhega.

Test karne ka sabse aasan tarika: `npm run dev` chalao, fir signup try karo — agar OTP email aa gayi lekin welcome email nahi aayi, console me `❌ Welcome email FAILED to send. Reason: ...` dikhega jisme exact error hoga.

## 10. Performance Notes

- **Gzip compression** on hai (`compression` middleware) — API responses aur website dono compressed jaate hain, mobile network pe fast load hoti hai
- **Static file caching** — website ki CSS/HTML files browser me 1 din tak cache hoti hain, baar-baar download nahi karni padti
- **Notification emails background me jaati hain** (naya-device alert, userId-changed, password-changed confirmation) — inka result response ko block nahi karta, isliye login/signup/profile-update turant respond karte hain (Gmail SMTP ka ~1-2 second lagne wala time response me nahi judta)
- **Business-critical emails await hoti hain** (OTP, welcome-email-with-password, reset-link) — kyuki inka fail/success response ka content decide karta hai (jaise fallback password bhejna), yeh intentional hai
- **Database indexes**: `email`, `userId`, aur `tokenHash` sab unique-indexed hain (MongoDB automatically banata hai) — queries fast rehti hain chahe lakhs users ho jaayein
- **`.lean()` queries** un jagah use ki hain jaha sirf "exist karta hai ya nahi" check karna hai (jaise duplicate-email/userId check) — poora Mongoose document na banaakar query thodi fast hoti hai
- **Cloudinary uploads non-blocking hain** — Node.js streams use karta hai, ek user ka photo-upload doosre users ke requests ko slow nahi karta
- **Email timeout tuned**: SMTP connection 8 second me respond na kare toh timeout, max 1 retry — bahut lambi wait nahi hoti agar SMTP genuinely down ho
