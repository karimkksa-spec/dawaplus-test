export function whatsappLink(phone,message){if(!/^[1-9]\d{7,14}$/.test(phone))return null;return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message||'مرحبًا، أريد الاستفسار عن توفر دواء.');}
