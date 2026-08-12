# Minicraft Status Bot

هذا المستودع يحتوي على بوت ديسكورد يعرض حالة سيرفرات Minecraft (Java & Bedrock) ويدعم Query و RCON.

ميزات:
- أوامر Slash (/status) وأمر نصي (!status)
- تحديثات دورية في قناة ودفع إشعارات عند توقف السيرفر
- دعم Query وRCON (إذا كانت مفعلة على السيرفر)
- Dockerfile للنشر السريع

نشر على Railway:
1. أضف هذا المستودع إلى GitHub (الخطوة تمت تلقائيًا من خلال هذا التزام).
2. افتح https://railway.app وأنشئ مشروعًا جديدًا > Deploy from GitHub.
3. اربط المستودع "3mkzor9/Minicraft-Status-Bot".
4. في صفحة Service > Variables أضف المتغيرات من .env.example.
5. اضغط Deploy.

ملاحظات:
- لا ترفع ملف .env إلى المستودع. استخدم Secrets في Railway.
- لتلقي أوامر نصية (prefix) فعل Message Content Intent في بوابة Discord Developer Portal.
- لتفعيل Query أو RCON في السيرفر عدّل server.properties (enable-query=true, enable-rcon=true) وعيّن rcon.password و rcon.port.
