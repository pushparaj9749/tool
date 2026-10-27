# Isekai Paradise — Clean Romance Visual Novel
# Ren'Py Script (game/script.rpy)

init python:
    pass

# Characters
define aryan = Character("Aryan", color="#0080ff")
define meera = Character("Meera", color="#ff69b4", show_two_window=True)
define lila = Character("Lila", color="#ffa500")
define narrator = Narrator()

# Scenes
label start:
    scene black
    with fade

    narrator "कॉलेज खत्म होने के बाद आपकी जिंदगी कुछ खास नहीं चल रही थी..."
    narrator "कोई नौकरी नहीं, कोई भविष्य नहीं — सिर्फ उम्मीदें टूट रही थीं।"

    show aryan normal at center
    with fade

    aryan "क्या यही मेरी जिंदगी है?"

    narrator "अचानक एक ट्रक सामने आ गया। सब कुछ अंधेरा हो गया।"

    scene black
    with fade

    narrator "जब आपकी आंख खुली, तो आप एक नई दुनिया में थे..."
    narrator "Evenralm — जादू, राक्षस और रोमांच से भरी एक फैंटेसी दुनिया।"

    scene bg_evenralm
    with fade

    show aryan surprised at center
    with fade

    meera "आप कौन हैं? आप यहां के नहीं लगते।"

    aryan "मैं... मैं नहीं जानता कि मैं कहां हूं।"

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

    show aryan normal at left
    show meera normal at right
    with fade

    meera "मैं मीरा हूं। मैं यहां एक हीलर हूं।"
    meera "मैं आपकी मदद करूंगी, डरो मत।"

    aryan "धन्यवाद, मीरा।"

    narrator "कुछ दिन बीतते हैं। आप मीरा के साथ ट्रेनिंग करते हैं, जादू सीखते हैं।"

    scene bg_training
    with fade

    show aryan smile at left
    show meera smile at right
    with fade

    meera "आप बहुत मजबूत हो रहे हैं, आर्यन।"
    aryan "यह सब आपके कारण संभव हुआ है।"

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

    show aryan normal at left
    show meera normal at right
    with fade

    meera "आर्यन... मैं खुश हूं कि आप यहां आए।"
    aryan "मैं भी, मीरा।"

    menu:
        "उसके करीब जाएं।":
            jump close_moment
        "थोड़ी दूरी बनाए रखें।":
            meera "ठीक है, हम धीरे-धीरे बढ़ेंगे।"
            jump meet_lila

label close_moment:
    scene bg_sunset_kiss
    with fade

    show aryan normal at left
    show meera smile at right
    with fade

    meera (softly) "क्या मैं... आपको किस कर सकती हूं?"

    menu:
        "हां।":
            meera "मैं आपको पसंद करती हूं, आर्यन।"
            aryan "मैं भी आपको पसंद करता हूं, मीरा।"
            jump relationship_confirmed
        "अभी नहीं।":
            meera "ठीक है। हम समय लेंगे।"
            jump meet_lila

label relationship_confirmed:
    scene bg_sunset_kiss
    with fade

    show aryan smile at left
    show meera smile at right
    with fade

    narrator "आप दोनों एक दूसरे के करीब आते हैं।"
    narrator "Evenralm में आपकी नई जिंदगी शुरू होती है, और आपके साथ हैं मीरा।"

    jump ending

label meet_lila:
    scene bg_training
    with fade

    show aryan normal at left
    show lila happy at right
    with fade

    lila "अरे आर्यन! मैंने सुना तुम मीरा के साथ ट्रेनिंग कर रहे हो।"

    aryan "हां, लिला। वह बहुत अच्छी हीलर है।"

    lila "मैं भी तुम्हारे साथ जादू सीखना चाहती हूं। क्या सिखाओगे मुझे?"

    menu:
        "हां, खुशी से।":
            lila "धन्यवाद आर्यन! तुम सबसे अच्छे हो।"
            jump lila_friend
        "माफ करना, मैं व्यस्त हूं।":
            lila "ओह... ठीक है। समझ सकती हूं।"
            jump lila_sad

label lila_friend:
    scene bg_evenralm
    with fade

    narrator "कुछ हफ्ते बाद..."
    narrator "आप मीरा और लिला दोनों के साथ समय बिताने लगते हैं।"

    show aryan smile at left
    show meera smile at center
    show lila happy at right
    with fade

    meera "आर्यन, तुम हमारे लिए खास हो।"
    lila "हां, हम तुम्हारी दोस्ती को पसंद करते हैं।"

    jump evening_stroll

label lila_sad:
    scene bg_evenralm
    with fade

    show aryan normal at left
    show meera normal at center
    with fade

    meera "चिंता मत करो, लिला। वह अभी समायोजित हो रहा है।"

    narrator "लिला थोड़ी उदास चली जाती है, लेकिन मीरा आपके साथ रहती है।"

    jump evening_stroll

label evening_stroll:
    scene bg_village
    with fade

    narrator "शाम को गांव की गलियों में टहलते हुए..."

    show aryan normal at left
    show meera smile at right
    with fade

    meera "आर्यन, क्या तुमने कभी सोचा था कि तुम्हारी जिंदगी ऐसे बदल जाएगी?"
    aryan "कभी नहीं। लेकिन मैं खुश हूं कि ऐसा हुआ।"

    menu:
        "मीरा की आंखों में देखें।":
            meera "तुम बहुत ईमानदार हो। मुझे अच्छा लगता है।"
            jump deeper_bond
        "आसमान की ओर देखें।":
            meera "आसमान आज बहुत सुंदर है, है ना?"
            jump deeper_bond

label deeper_bond:
    scene bg_village_night
    with fade

    show aryan normal at left
    show meera shy at right
    with fade

    meera "आर्यन... मैं तुम्हें बताना चाहती हूं कि मैं क्या महसूस करती हूं।"
    aryan "बोलो मीरा, मैं सुन रहा हूं।"

    meera "मैं... मैं तुम्हें पसंद करती हूं। सिर्फ एक दोस्त से कहीं ज़्यादा।"

    menu:
        "मीरा को गले लगाएं।":
            meera (softly) "धन्यवाद आर्यन। मैं तुम्हारे साथ सुरक्षित महसूस करती हूं।"
            jump true_love
        "शब्दों से जवाब दें।":
            aryan "मीरा, मैं भी तुम्हें पसंद करता हूं। बहुत ज़्यादा।"
            jump true_love

label true_love:
    scene bg_village_night
    with fade

    show aryan smile at left
    show meera smile at right
    with fade

    narrator "Evenralm में आपकी कहानी बस शुरू हुई है।"
    narrator "जादू, रोमांच और प्यार से भरी एक नई जिंदगी।"

    jump ending

label ending:
    scene black
    with fade

    narrator "Evenralm में आपकी नई जिंदगी अभी शुरू हुई है।"
    narrator "और आपके साथ हैं नए दोस्त — और शायद पहला प्यार भी।"

    menu:
        "दोबारा खेलें।":
            jump start
        "खेल छोड़ें।":
            return

    return