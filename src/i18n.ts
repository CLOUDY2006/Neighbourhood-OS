import { useSyncExternalStore } from "react";

export const LANGS = [{ code: "en", label: "English", speech: "en-IN" }, { code: "hi", label: "हिन्दी", speech: "hi-IN" }];
let lang = "en";
try { lang = localStorage.getItem("nos-lang") || (navigator.language.startsWith("hi") ? "hi" : "en"); } catch { /* ignore */ }
if (typeof document !== "undefined") document.documentElement.lang = lang;
const subs = new Set<() => void>();
export function setLang(l: string) {
  lang = l;
  try { localStorage.setItem("nos-lang", l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  subs.forEach(f => f());
}
export const useLang = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => lang, () => lang);
export const speechLang = () => LANGS.find(l => l.code === lang)?.speech ?? "en-IN";

const HI: Record<string, string> = {
  Command: "कमांड", Report: "रिपोर्ट करें", Reports: "रिपोर्ट डैशबोर्ड", SOS: "एसओएस", Missions: "मिशन", Resources: "संसाधन", Prepare: "तैयारी", World: "विश्व", Impact: "प्रभाव", People: "लोग", Account: "खाता",
  "Demo mode": "डेमो मोड", Live: "लाइव", "Switch neighborhood": "मोहल्ला बदलें", "Exit demo": "डेमो से बाहर", "Reset demo": "डेमो रीसेट करें", Role: "भूमिका", Resident: "निवासी", Volunteer: "स्वयंसेवक", Coordinator: "समन्वयक", Language: "भाषा",
  Offline: "ऑफ़लाइन", "waiting to send": "भेजने की प्रतीक्षा में", "Skip to the list": "सूची पर जाएँ", Notifications: "सूचनाएँ",
  "Official alert near this neighborhood": "इस मोहल्ले के पास आधिकारिक चेतावनी", "Heads up: hazard activity nearby": "सावधान: पास में खतरे की गतिविधि", "See on the world map": "विश्व मानचित्र पर देखें",
  "Follow your national authorities. If anyone is in danger, call your local emergency number first. Crisis Mode is on: use the SOS tab if you need help and the Resources tab to find shelters.": "अपने राष्ट्रीय अधिकारियों के निर्देशों का पालन करें। यदि कोई खतरे में है तो सबसे पहले अपने स्थानीय आपातकालीन नंबर (भारत में 112) पर कॉल करें। संकट मोड चालू है: मदद चाहिए तो एसओएस टैब और आश्रय खोजने के लिए संसाधन टैब देखें।",
  "Call your local emergency number first": "सबसे पहले अपने स्थानीय आपातकालीन नंबर पर कॉल करें",
  "If anyone is in immediate danger, call emergency services (for example 112, 911 or 999) before anything else. Neighbors and volunteers may not see a request in time.": "यदि कोई तत्काल खतरे में है, तो सबसे पहले आपातकालीन सेवाओं को कॉल करें (जैसे भारत में 112)। हो सकता है पड़ोसी और स्वयंसेवक अनुरोध समय पर न देख पाएँ।",
  "An official hazard alert is active near this neighborhood, so Crisis Mode is on.": "इस मोहल्ले के पास आधिकारिक चेतावनी सक्रिय है, इसलिए संकट मोड चालू है।",
  "Ask for help": "मदद माँगें", "Medical help": "चिकित्सा सहायता", "Rescue or trapped": "बचाव / फँसे हुए", Shelter: "आश्रय", "Food or water": "भोजन या पानी", "Something else": "कुछ और",
  "Short note, e.g. 2nd floor, water rising": "छोटा नोट, जैसे दूसरी मंज़िल, पानी बढ़ रहा है", "Click the map to choose where you are, or use your current location.": "मानचित्र पर क्लिक करके अपनी जगह चुनें, या वर्तमान स्थान उपयोग करें।",
  "Use my current location": "मेरा वर्तमान स्थान उपयोग करें",
  "I agree to share this exact location and note with this neighborhood's coordinators and any volunteer they assign. It is deleted when the request is closed, or after 24 hours.": "मैं यह सटीक स्थान और नोट इस मोहल्ले के समन्वयकों और उनके द्वारा सौंपे गए स्वयंसेवक के साथ साझा करने के लिए सहमत हूँ। अनुरोध बंद होने पर या 24 घंटे बाद इसे हटा दिया जाएगा।",
  "Send SOS request": "एसओएस अनुरोध भेजें", "A coordinator will review the request. It is unverified until someone confirms it.": "समन्वयक अनुरोध की समीक्षा करेगा। जब तक कोई पुष्टि नहीं करता, यह असत्यापित है।",
  "Waiting for a coordinator": "समन्वयक की प्रतीक्षा में", "Seen by a coordinator": "समन्वयक ने देखा", "Volunteer assigned": "स्वयंसेवक सौंपा गया", Helped: "मदद मिली", Closed: "बंद",
  Acknowledge: "देखा गया", Assign: "सौंपें", "Mark helped": "मदद मिली चिह्नित करें", Close: "बंद करें", "Cancel my request": "मेरा अनुरोध रद्द करें", "SOS board": "एसओएस बोर्ड", "Your requests": "आपके अनुरोध",
  "Live issues": "सक्रिय समस्याएँ", "Event log": "घटना लॉग", Open: "खुली", "In progress": "प्रगति में", Fixed: "ठीक हुईं",
  "Report a problem": "समस्या की रिपोर्ट करें", "Short title": "संक्षिप्त शीर्षक", "Submit report": "रिपोर्ट भेजें", "Chosen location": "चुना हुआ स्थान",
  "What is happening? Please do not include names, phone numbers or faces.": "क्या हो रहा है? कृपया नाम, फ़ोन नंबर या चेहरे शामिल न करें।",
  "Click the map to choose the location.": "मानचित्र पर क्लिक करके स्थान चुनें।", "Add to this report": "इस रिपोर्ट में जोड़ें", "Possible duplicates": "संभावित डुप्लिकेट",
  Speak: "बोलें", "Listening…": "सुन रहा है…", "Speak instead of typing": "टाइप करने की जगह बोलें",
  "Are you safe?": "क्या आप सुरक्षित हैं?", "I am safe": "मैं सुरक्षित हूँ", "I need help": "मुझे मदद चाहिए", "Safety check-in": "सुरक्षा जाँच",
  "Notice board": "सूचना पट्ट", "Neighbor exchange": "पड़ोसी आदान-प्रदान", Offer: "प्रस्ताव", Request: "अनुरोध", "Emergency plan": "आपातकालीन योजना", "Evacuation routes": "निकासी मार्ग", "Assembly points and equipment": "सभा स्थल और उपकरण",
  "Who can help": "कौन मदद कर सकता है", "Extra help register": "अतिरिक्त सहायता रजिस्टर", Settings: "सेटिंग्स", "Text size": "अक्षर आकार", "High contrast": "उच्च कंट्रास्ट", "Reduce motion": "गति कम करें",
  Normal: "सामान्य", Large: "बड़ा", "Extra large": "बहुत बड़ा", "Try the simulated demo (no account)": "सिम्युलेटेड डेमो आज़माएँ (खाते की ज़रूरत नहीं)", "Find a neighborhood": "मोहल्ला खोजें", "Use my location": "मेरा स्थान उपयोग करें",
  "Join this area's neighborhood": "इस क्षेत्र के मोहल्ले से जुड़ें", "Sign in": "साइन इन", "Create account": "खाता बनाएँ", "Sign out": "साइन आउट", "Your neighborhoods": "आपके मोहल्ले",
  "Council reports": "परिषद रिपोर्ट", "Download CSV": "CSV डाउनलोड करें", "Print or save as PDF": "प्रिंट करें या PDF सहेजें", "Weekly summary": "साप्ताहिक सारांश",
  "AI agent": "एआई एजेंट", Pulse: "नब्ज़", "What-if": "क्या-अगर", Detected: "पहचाना गया", "Complaint goes to": "शिकायत जाएगी", "Use these suggestions": "ये सुझाव अपनाएँ", "Start the AI agent": "एआई एजेंट शुरू करें",
  "Complaint route": "शिकायत का रास्ता", "Complaint draft": "शिकायत का मसौदा", Escalation: "एस्केलेशन", "Escalation ready": "एस्केलेशन तैयार", "Save edits": "बदलाव सहेजें", Approve: "मंज़ूर करें",
  "Copy complaint": "शिकायत कॉपी करें", "I sent it": "मैंने भेज दी", "Send (simulated)": "भेजें (नकली)", Save: "सहेजें", "If unresolved by": "यदि इस तारीख तक हल न हुआ:", "the agent prepares an escalation to": "तो एजेंट एस्केलेशन तैयार करेगा:",
  "You approve before anything is sent.": "कुछ भी भेजने से पहले आप मंज़ूरी देते हैं।", "Prepare escalation now": "अभी एस्केलेशन तैयार करें", "Suggested mission": "सुझाया गया मिशन", "Create this mission": "यह मिशन बनाएँ",
  "Understand and prepare complaint": "समझें और शिकायत तैयार करें", "Report understood": "रिपोर्ट समझी गई", "Duplicates checked": "डुप्लिकेट जाँचे गए", "Complaint route chosen": "शिकायत का रास्ता चुना गया",
  "Complaint drafted": "शिकायत का मसौदा तैयार", "Approved by a person": "व्यक्ति द्वारा मंज़ूर", "Sent to the authority": "प्राधिकरण को भेजी गई", "Reference number received": "संदर्भ संख्या मिली",
  "Community mission created": "सामुदायिक मिशन बना", "Volunteers joined": "स्वयंसेवक जुड़े", "Proof of fix uploaded": "समाधान का प्रमाण अपलोड", "Verified resolved": "हल होना सत्यापित",
};
export function useT() {
  const l = useLang();
  return (s: string) => (l === "hi" ? HI[s] ?? s : s);
}
