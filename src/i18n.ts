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
  "Show my location": "मेरी लोकेशन दिखाएं", "YOU ARE HERE": "आप यहाँ हैं", "You are here": "आप यहाँ हैं", "Finding your location…": "आपकी लोकेशन खोजी जा रही है…",
  "inside this neighborhood": "इस मोहल्ले के अंदर", "from the center of this neighborhood": "इस मोहल्ले के केंद्र से दूर", "Open my area": "मेरा इलाका खोलें",
  "This demo area is simulated, so you will not appear on it.": "यह डेमो इलाका नकली है, इसलिए आप इस पर नहीं दिखेंगे।", Stop: "बंद करें",
  "Location is blocked. Allow it in your browser's site settings, then try again.": "लोकेशन बंद है। ब्राउज़र की साइट सेटिंग में अनुमति दें, फिर दोबारा कोशिश करें।",
  "Your browser does not support location.": "आपका ब्राउज़र लोकेशन सपोर्ट नहीं करता।", "Could not get your location. Try again.": "आपकी लोकेशन नहीं मिल सकी। दोबारा कोशिश करें।",
  "Your location stays on this device. Opening your area sends only a 1 km area code.": "आपकी लोकेशन इसी डिवाइस पर रहती है। इलाका खोलने पर केवल लगभग 1 किमी का क्षेत्र कोड भेजा जाता है।",
  "All reports": "सभी रिपोर्ट", Step: "चरण", Next: "अगला", "More options": "और विकल्प", "Evidence and updates": "सबूत और अपडेट", "Volunteers and mission": "स्वयंसेवक और मिशन", History: "इतिहास", "How urgent": "कितना ज़रूरी",
  "person has reported this.": "व्यक्ति ने यह रिपोर्ट किया है।", "people have reported this.": "लोगों ने यह रिपोर्ट किया है।",
  "Tap a pin on the map or a report below to see what is happening and what you can do.": "क्या हो रहा है और आप क्या कर सकते हैं, यह देखने के लिए नक्शे पर किसी पिन या नीचे की रिपोर्ट पर टैप करें।",
  "Waiting for a coordinator to look at this report.": "किसी समन्वयक के इस रिपोर्ट को देखने का इंतज़ार है।", "A coordinator is looking at this report.": "एक समन्वयक इस रिपोर्ट को देख रहा है।",
  "Someone has been assigned to fix this.": "इसे ठीक करने के लिए किसी को सौंपा गया है।", "Work on this problem is under way.": "इस समस्या पर काम चल रहा है।",
  "A fix was submitted. A different person has to confirm it.": "ठीक करने की जानकारी जमा हुई है। कोई दूसरा व्यक्ति इसकी पुष्टि करेगा।", "This problem was fixed and confirmed.": "यह समस्या ठीक हो गई और इसकी पुष्टि हो चुकी है।",
  "Not yet checked by a coordinator.": "समन्वयक ने अभी जाँच नहीं की है।", "A coordinator is checking that this is real.": "समन्वयक जाँच रहा है कि यह सही है।", "A coordinator confirmed this is real.": "समन्वयक ने पुष्टि की कि यह सही है।",
  "A coordinator marked this as disputed.": "समन्वयक ने इसे विवादित बताया है।", "A coordinator confirmed the fix.": "समन्वयक ने ठीक होने की पुष्टि की है।",
  "What happens next": "आगे क्या होगा", "Check that this report is real, then start the review.": "जाँचें कि यह रिपोर्ट सही है, फिर समीक्षा शुरू करें।", "Start review": "समीक्षा शुरू करें",
  "A coordinator needs to start the review. If you see this problem too, confirm it with the button below.": "किसी समन्वयक को समीक्षा शुरू करनी है। अगर आपको भी यह समस्या दिखती है तो नीचे के बटन से पुष्टि करें।",
  "Decide who will fix it: approve the action plan or create a mission, then mark it as assigned.": "तय करें कि इसे कौन ठीक करेगा: कार्य-योजना मंज़ूर करें या मिशन बनाएं, फिर इसे सौंपा हुआ चिह्नित करें।", "Mark as assigned": "सौंपा हुआ चिह्नित करें",
  "A coordinator is deciding who will fix this.": "समन्वयक तय कर रहा है कि इसे कौन ठीक करेगा।", "When the fix is done, add a photo or note as proof. This moves it to In progress.": "ठीक करने के बाद सबूत के रूप में फ़ोटो या नोट जोड़ें। इससे यह काम जारी की स्थिति में चला जाएगा।",
  "Mark work as started": "काम शुरू हुआ चिह्नित करें", "Someone is assigned. Waiting for the work to start.": "किसी को सौंपा गया है। काम शुरू होने का इंतज़ार है।", "Add a photo or note as proof of the fix.": "ठीक करने के सबूत के रूप में फ़ोटो या नोट जोड़ें।",
  "Proof was added. You can add more.": "सबूत जोड़ा जा चुका है। आप और जोड़ सकते हैं।", "Submit fix for review": "समीक्षा के लिए ठीक किया हुआ काम जमा करें", "Add proof first, then you can submit it.": "पहले सबूत जोड़ें, फिर जमा कर सकेंगे।",
  "Proof was added. A coordinator will submit the fix for review.": "सबूत जोड़ा गया है। समन्वयक इसे समीक्षा के लिए जमा करेगा।", "Work is under way. A coordinator will submit the fix for review when it is done.": "काम चल रहा है। पूरा होने पर समन्वयक इसे समीक्षा के लिए जमा करेगा।",
  "You submitted this fix, so a different coordinator or moderator must approve it.": "आपने यह काम जमा किया है, इसलिए कोई दूसरा समन्वयक या मॉडरेटर ही इसे मंज़ूर कर सकता है।", "Demo: switch to Moderator to approve": "डेमो: मंज़ूरी के लिए मॉडरेटर बनें",
  "Ask another coordinator or a moderator to open this report and approve it. A neighbor can be made a coordinator from the Account tab.": "किसी दूसरे समन्वयक या मॉडरेटर से कहें कि वह यह रिपोर्ट खोलकर मंज़ूर करे। खाता टैब से किसी पड़ोसी को समन्वयक बनाया जा सकता है।",
  "A coordinator has not marked this as verified yet.": "समन्वयक ने इसे अभी सत्यापित नहीं किया है।",
  "TinyFish web agent": "TinyFish वेब एजेंट",
  "Search the live web for your city's official complaint page, helpline and tracker. Free to run. This is a suggestion; check it before you send anything.": "आपके शहर का आधिकारिक शिकायत पेज, हेल्पलाइन और ट्रैकर इंटरनेट पर खोजें। इसे चलाना मुफ़्त है। यह केवल एक सुझाव है; कुछ भी भेजने से पहले इसे जाँच लें।",
  "City (optional)": "शहर (वैकल्पिक)", City: "शहर",
  "Reading official pages…": "आधिकारिक पेज पढ़े जा रहे हैं…",
  "Verify this route with TinyFish": "TinyFish से यह रास्ता जाँचें",
  "Simulated example. No real website was read.": "यह नकली उदाहरण है। कोई असली वेबसाइट नहीं पढ़ी गई।",
  "City searched": "खोजा गया शहर", "Government website": "सरकारी वेबसाइट", "Not confirmed as official": "आधिकारिक होने की पुष्टि नहीं",
  "Helpline numbers found on the pages": "पेजों पर मिले हेल्पलाइन नंबर", "Email addresses found": "मिले ईमेल पते",
  "Track a complaint": "शिकायत ट्रैक करें", "Complaint page": "शिकायत पेज", "Use this tracker": "यह ट्रैकर इस्तेमाल करें",
  "Check complaint status": "शिकायत की स्थिति जाँचें",
  "A TinyFish web agent opens the public tracker page and looks up your reference number. It only reads. It never logs in or files anything. It uses TinyFish credits.": "TinyFish वेब एजेंट सार्वजनिक ट्रैकर पेज खोलकर आपका संदर्भ नंबर देखता है। वह केवल पढ़ता है। वह कभी लॉग इन नहीं करता और कुछ दर्ज नहीं करता। इसमें TinyFish क्रेडिट लगते हैं।",
  "Reference number": "संदर्भ संख्या", "Tracker page address": "ट्रैकर पेज का पता", "Check status": "स्थिति जाँचें", "Checking…": "जाँच हो रही है…",
  "The agent is working on the website. This can take up to two minutes.": "एजेंट वेबसाइट पर काम कर रहा है। इसमें दो मिनट तक लग सकते हैं।", "Watch it live": "लाइव देखें",
  "The check did not finish.": "जाँच पूरी नहीं हुई।", "Simulated example. No real portal was visited.": "यह नकली उदाहरण है। कोई असली पोर्टल नहीं खोला गया।",
  "No status text": "स्थिति का कोई पाठ नहीं", "The agent could not find a status for this number.": "एजेंट को इस नंबर की कोई स्थिति नहीं मिली।",
  "This is what the website showed, read by an AI agent. Check the page yourself before relying on it.": "यह वही है जो वेबसाइट पर दिखा, जिसे AI एजेंट ने पढ़ा। भरोसा करने से पहले पेज खुद देख लें।",
  "Record as": "इस रूप में दर्ज करें", "Resolved by the authority": "प्राधिकरण द्वारा हल किया गया", "Acknowledged by the authority": "प्राधिकरण ने स्वीकार किया",
  "Powered by TinyFish": "TinyFish द्वारा संचालित",
  "Type a real city to run it live": "इसे लाइव चलाने के लिए कोई असली शहर लिखें",
  "Is the problem fixed?": "क्या समस्या ठीक हो गई?", "The team says this is done. You reported this problem (or confirmed it), so your answer counts: if you say it is fixed, the report is resolved.": "टीम कहती है कि काम पूरा हो गया। आपने यह समस्या बताई थी (या इसकी पुष्टि की थी), इसलिए आपका जवाब मायने रखता है: आप ठीक कहेंगे तो रिपोर्ट हल मानी जाएगी।", "Optional comment": "वैकल्पिक टिप्पणी", "Yes, it is fixed": "हाँ, ठीक हो गई", "No, not fully fixed": "नहीं, पूरी तरह ठीक नहीं हुई", "This report was closed without confirmation.": "यह रिपोर्ट बिना पुष्टि के बंद की गई थी।", "Nobody answered, so a coordinator closed it. If the problem is still there, you can reopen it.": "किसी ने जवाब नहीं दिया, इसलिए समन्वयक ने इसे बंद किया। अगर समस्या अब भी है तो आप इसे दोबारा खोल सकते हैं।", "It is still broken. Reopen it": "अब भी खराब है। दोबारा खोलें", "Closed without confirmation": "बिना पुष्टि के बंद", "You submitted this fix, so you cannot approve it yourself. The reporters were asked. A different coordinator or moderator can approve it too.": "आपने यह काम जमा किया है, इसलिए आप खुद इसे मंज़ूर नहीं कर सकते। रिपोर्ट करने वालों से पूछा गया है। कोई दूसरा समन्वयक या मॉडरेटर भी इसे मंज़ूर कर सकता है।", "Close without confirmation": "बिना पुष्टि के बंद करें", "Possible after 7 days without an answer.": "7 दिन तक जवाब न मिलने पर संभव।", "days left": "दिन बाकी", "Demo: answer as the reporter": "डेमो: रिपोर्टर के रूप में जवाब दें", "Demo: reporter says not fixed": "डेमो: रिपोर्टर कहता है ठीक नहीं हुआ", "Demo: skip the 7-day wait": "डेमो: 7 दिन का इंतज़ार छोड़ें", "The reporter confirmed the fix.": "रिपोर्ट करने वाले ने ठीक होने की पुष्टि की।", "No reporter confirmed the fix.": "किसी रिपोर्टर ने ठीक होने की पुष्टि नहीं की।", "This problem was fixed and a reviewer approved it.": "यह समस्या ठीक हुई और समीक्षक ने इसे मंज़ूर किया।", "This problem was fixed. The person who reported it confirmed it.": "यह समस्या ठीक हुई। रिपोर्ट करने वाले ने इसकी पुष्टि की।", "This report was closed without confirmation. Nobody answered in 7 days.": "यह रिपोर्ट बिना पुष्टि के बंद की गई। 7 दिन में किसी ने जवाब नहीं दिया।", "A fix was submitted. The reporter, or a different coordinator or moderator, has to confirm it.": "ठीक करने की जानकारी जमा हुई है। रिपोर्ट करने वाले को, या किसी दूसरे समन्वयक या मॉडरेटर को, इसकी पुष्टि करनी होगी।", "Priority details": "प्राथमिकता का विवरण",
};
export function useT() {
  const l = useLang();
  return (s: string) => (l === "hi" ? HI[s] ?? s : s);
}