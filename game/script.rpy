# Isekai Paradise — Clean Romance Visual Novel
# Ren'Py Script (game/script.rpy)

init python:
    pass

# Characters
define pc = Character("Aryan", color="#0080ff")
define meera = Character("Meera", color="#ff69b4", show_two_window=True)
define narrator = Narrator()

# Scenes
label start:
    scene black
    with fade

    narrator "कॉलेज खत्म होने के बाद आपकी जिंदगी कुछ खास नहीं चल रही थी..."
    narrator "कोई नौकरी नहीं, कोई भविष्य नहीं — सिर्फ उम्मीदें टूट रही थीं।"

    pc "क्या यही मेरी जिंदगी है?"

    narrator "अचानक एक ट्रक सामने आ गया। सब कुछ अंधेरा हो गया।"

    scene black
    with fade

    narrator "जब आपकी आंख खुली, तो आप एक नई दुनिया में थे..."
    narrator "Evenralm — जादू, राक्षस और रोमांच से भरी एक फैंटेसी दुनिया।"

    scene bg_evenralm
    with fade

    meera "आप कौन हैं? आप यहां के नहीं लगते।"

    pc "मैं... मैं नहीं जानता कि मैं कहां हूं।"

    menu:
        "मैं आर्यन हूं, दूसरी दुनिया से आया हूं।":
            meera "दूसरी दुनिया? इसका मतलब... आप एक आउटसाइडर हैं?"
            jump met_meera
        "मुझे कुछ याद नहीं आ रहा।":
            meera "भूलने की बीमारी? यहां यह खतरनाक हो सकता है।"
            jump met_meera

label met_meera:
    scene bg_evenralm
    with fade

    meera "मैं मीरा हूं। मैं यहां एक हीलर हूं।"
    meera "मैं आपकी मदद करूंगी, डरो मत।"

    pc "धन्यवाद, मीरा।"

    narrator "कुछ दिन बीतते हैं। आप मीरा के साथ ट्रेनिंग करते हैं, जादू सीखते हैं।"

    scene bg_training
    with fade

    meera "आप बहुत मजबूत हो रहे हैं, आर्यन।"
    pc "यह सब आपके कारण संभव हुआ है।"

    menu:
        "उसका हाथ पकड़ें।":
            meera (smile) "आप शर्मा रहे हैं।"
            jump sunset_scene
        "शरमाकर नजर हटा लें।":
            meera (laugh) "बहुत शर्मीले हैं आप।"
            jump sunset_scene

label sunset_scene:
    scene bg_sunset
    with fade

    narrator "Evenralm में सूरज डूब रहा है।"
    meera "आर्यन... मैं खुश हूं कि आप यहां आए।"
    pc "मैं भी, मीरा।"

    meera "क्या मैं... आपको किस कर सकती हूं?"

    menu:
        "हां।":
            scene bg_sunset_kiss
            with fade
            meera (softly) "मैं आपको पसंद करती हूं, आर्यन।"
            pc "मैं भी आपको पसंद करता हूं, मीरा।"
            jump ending
        "अभी नहीं।":
            meera "ठीक है। हम धीरे-धीरे बढ़ेंगे।"
            jump ending

label ending:
    scene black
    with fade

    narrator "Evenralm में आपकी नई जिंदगी अभी शुरू हुई है।"
    narrator "और आपके साथ हैं मीरा — आपका पहला प्यार।"

    return