# Isekai Paradise — Clean Romance Visual Novel (Extended)
# Ren'Py Script — Big Version (10-15 days gameplay)
# game/script.rpy

## ============================================================================
## INIT — Variables & Setup
## ============================================================================
init python:
    pass

## Game state variables
default day = 1
default max_days = 30
default time_of_day = "morning"   # morning, afternoon, evening, night

## Relationship points
default meera_love = 0
default lila_love = 0
default elena_love = 0

## Stats
default magic_stat = 0
default strength_stat = 0
default charm_stat = 0

## Flags
default met_meera = False
default met_lila = False
default met_elena = False
default meera_route = False
default lila_route = False
default elena_route = False
default confessed_meera = False
default confessed_lila = False
default confessed_elena = False

## ============================================================================
## CHARACTERS
## ============================================================================
define aryan = Character("Aryan", color="#0080ff")
define meera = Character("Meera", color="#ff69b4", show_two_window=True)
define lila = Character("Lila", color="#ffa500")
define elena = Character("Elena", color="#9932cc")
define narrator = Narrator()
define system = Character("システム", color="#ffffff")

## ============================================================================
## LABELS — MAIN GAME
## ============================================================================
label start:
    scene black
    with fade

    narrator "Isekai Paradise — Clean Romance"
    narrator "एक बड़ी फैंटेसी दुनिया में आपकी नई जिंदगी।"
    narrator "30 दिन तक खेलें, रिश्ते बनाएं, जादू सीखें, और अपना रास्ता चुनें।"

    menu:
        "नई शुरुआत":
            jump day_1_morning
        "खेल छोड़ें":
            return

## ============================================================================
## DAY SYSTEM HELPERS
## ============================================================================
label day_transition:
    $ time_of_day = "morning"
    $ day += 1
    if day > max_days:
        jump game_ending
    jump day_morning

label day_morning:
    scene black
    with fade
    narrator "दिन [day] — सुबह"
    $ time_of_day = "morning"
    jump location_choice

label day_afternoon:
    scene black
    with fade
    narrator "दिन [day] — दोपहर"
    $ time_of_day = "afternoon"
    jump location_choice

label day_evening:
    scene black
    with fade
    narrator "दिन [day] — शाम"
    $ time_of_day = "evening"
    jump location_choice

label day_night:
    scene black
    with fade
    narrator "दिन [day] — रात"
    $ time_of_day = "night"
    jump night_choice

label location_choice:
    menu:
        "गिल्ड हाउस जाएं":
            jump guild_house
        "ट्रेनिंग ग्राउंड जाएं":
            jump training_ground
        "जंगल में घूमें":
            jump forest
        "मंदिर जाएं":
            jump temple
        "बाज़ार जाएं":
            jump market
        "आराम करें (समय बीत जाएगा)":
            jump rest

## ============================================================================
## DAY 1
## ============================================================================
label day_1_morning:
    scene black
    with fade
    narrator "दिन 1 — आप Evenralm में अपनी पहली सुबह जगते हैं।"
    show aryan normal at center
    with fade
    aryan "क्या यह सच है? मैं सच में दूसरी दुनिया में हूं?"
    narrator "घंटी बजती है — कोई दरवाजा खटखटा रहा है।"
    meera "नमस्ते! मैं मीरा हूं, गिल्ड हीलर। आप नए आए हैं न?"
    jump day_1_afternoon

label day_1_afternoon:
    scene bg_training
    with fade
    show aryan normal at left
    show meera smile at right
    meera "आर्यन, आज हम बेसिक हीलिंग स्पेल सीखेंगे।"
    aryan "मैं तैयार हूं, मीरा।"
    $ magic_stat += 5
    $ meera_love += 5
    narrator "मैजिक +5, मीरा का प्यार +5"
    jump day_1_evening

label day_1_evening:
    scene bg_sunset
    with fade
    show aryan normal at left
    show meera normal at right
    meera "पहला दिन कैसा रहा?"
    aryan "बहुत अच्छा रहा, आपकी वजह से।"
    $ meera_love += 5
    jump day_1_night

label day_1_night:
    scene black
    with fade
    narrator "पहला दिन खत्म।"
    jump day_transition

## ============================================================================
## DAY 2
## ============================================================================
label day_2_morning:
    scene black
    with fade
    narrator "दिन 2 — सुबह की हवा में मैजिक की खुशबू है।"
    show aryan normal at center
    aryan "आज कुछ नया सीखना है।"
    jump day_2_afternoon

label day_2_afternoon:
    scene bg_training
    with fade
    show aryan smile at left
    show lila happy at right
    lila "अरे आर्यन! मैं लिला हूं। क्या आप मुझे भी सिखाएंगे?"
    aryan "बेशक, लिला।"
    $ magic_stat += 5
    $ lila_love += 5
    $ met_lila = True
    narrator "लिला से मुलाकात हुई। मैजिक +5, लिला का प्यार +5"
    jump day_2_evening

label day_2_evening:
    scene bg_village
    with fade
    show aryan normal at left
    show meera smile at right
    meera "लिला अच्छी बच्ची है, लेकिन उसकी ऊर्जा बहुत ज़्यादा है।"
    aryan "हां, वह बहुत एनर्जेटिक है।"
    jump day_2_night

label day_2_night:
    scene black
    with fade
    narrator "दिन 2 खत्म।"
    jump day_transition

## ============================================================================
## DAY 3 — MEERA ROUTE START
## ============================================================================
label day_3_morning:
    scene black
    with fade
    narrator "दिन 3 — मीरा के साथ विशेष हीलिंग सेशन।"
    show aryan normal at center
    aryan "मीरा, क्या आप मुझे एडवांस हीलिंग सिखा सकती हैं?"
    jump day_3_afternoon

label day_3_afternoon:
    scene bg_temple
    with fade
    show aryan normal at left
    show meera normal at right
    meera "मंदिर में मैजिक ज़्यादा मजबूत होता है। ध्यान लगाएं।"
    $ magic_stat += 10
    $ meera_love += 10
    narrator "मैजिक +10, मीरा का प्यार +10"
    jump day_3_evening

label day_3_evening:
    scene bg_sunset
    with fade
    show aryan normal at left
    show meera shy at right
    meera "आर्यन... आप बहुत मेहनती हैं। मुझे अच्छा लगता है।"
    menu:
        "मीरा का हाथ पकड़ें":
            $ meera_love += 10
            meera "आप बहुत मीठे हैं।"
            jump day_3_night
        "मुस्कुराकर देखें":
            meera "आप शरारती हैं।"
            jump day_3_night

label day_3_night:
    scene black
    with fade
    narrator "दिन 3 खत्म।"
    jump day_transition

## ============================================================================
## DAY 4 — LILA ROUTE START
## ============================================================================
label day_4_morning:
    scene black
    with fade
    narrator "दिन 4 — लिला के साथ जंगल ट्रेनिंग।"
    show aryan normal at center
    aryan "लिला, आज जंगल में ट्रेनिंग करते हैं।"
    jump day_4_afternoon

label day_4_afternoon:
    scene bg_forest
    with fade
    show aryan smile at left
    show lila happy at right
    lila "देखो आर्यन! वहां एक मैजिकल फ्लावर है!"
    $ strength_stat += 10
    $ lila_love += 10
    narrator "स्ट्रेंथ +10, लिला का प्यार +10"
    jump day_4_evening

label day_4_evening:
    scene bg_sunset
    with fade
    show aryan normal at left
    show lila happy at right
    lila "आर्यन, तुम मेरे सबसे अच्छे दोस्त हो!"
    aryan "तुम भी मेरी अच्छी दोस्त हो, लिला।"
    jump day_4_night

label day_4_night:
    scene black
    with fade
    narrator "दिन 4 खत्म।"
    jump day_transition

## ============================================================================
## DAY 5 — ELENA INTRO
## ============================================================================
label day_5_morning:
    scene black
    with fade
    narrator "दिन 5 — गिल्ड हाउस में एक नई मुलाकात।"
    show aryan normal at center
    aryan "आज गिल्ड हाउस जाता हूं।"
    jump day_5_afternoon

label day_5_afternoon:
    scene bg_guild
    with fade
    show aryan normal at left
    show elena normal at right
    elena "नमस्ते, मैं एलेना हूं। गिल्ड की जादूगर।"
    aryan "मैं आर्यन। नई दुनिया में आया हूं।"
    elena "स्वागत है, आउटसाइडर।"
    $ met_elena = True
    $ charm_stat += 5
    narrator "एलेना से मुलाकात। चार्म +5"
    jump day_5_evening

label day_5_evening:
    scene bg_market
    with fade
    show aryan normal at left
    show elena smile at right
    elena "बाज़ार में मैजिकल पोशन मिलते हैं। क्या देखना चाहोगे?"
    aryan "ज़रूर, एलेना।"
    jump day_5_night

label day_5_night:
    scene black
    with fade
    narrator "दिन 5 खत्म।"
    jump day_transition

## ============================================================================
## DAYS 6-30 FRAMEWORK (Repeating structure with events)
## ============================================================================
label day_generic_morning:
    scene black
    with fade
    narrator "दिन [day] — सुबह। आज क्या करेंगे?"
    jump location_choice

label guild_house:
    scene bg_guild
    with fade
    show aryan normal at center
    narrator "गिल्ड हाउस में आपका स्वागत है।"
    menu:
        "मीरा से मिलें":
            $ meera_love += 5
            meera "आर्यन! आप यहां हैं।"
            jump after_guild
        "एलेना से मिलें":
            $ elena_love += 5
            elena "आओ, आज कुछ नया सिखाती हूं।"
            jump after_guild
        "एकांत में अभ्यास करें":
            $ magic_stat += 5
            narrator "मैजिक +5"
            jump after_guild

label after_guild:
    narrator "गिल्ड हाउस से समय बीत गया।"
    jump day_afternoon

label training_ground:
    scene bg_training
    with fade
    show aryan normal at center
    narrator "ट्रेनिंग ग्राउंड पर पसीना बहाएं।"
    menu:
        "ताकत बढ़ाएं":
            $ strength_stat += 10
            narrator "स्ट्रेंथ +10"
            jump after_training
        "मैजिक अभ्यास करें":
            $ magic_stat += 10
            narrator "मैजिक +10"
            jump after_training
        "लिलासे मिलें":
            $ lila_love += 10
            lila "आर्यन! साथ ट्रेनिंग करेंगे?"
            jump after_training

label after_training:
    narrator "ट्रेनिंग खत्म।"
    jump day_evening

label forest:
    scene bg_forest
    with fade
    show aryan normal at center
    narrator "जंगल में मैजिकल प्राणियों का सामना।"
    menu:
        "लड़ा जाए":
            $ strength_stat += 5
            narrator "स्ट्रेंथ +5"
            jump after_forest
        "भागा जाए":
            $ charm_stat += 5
            narrator "चार्म +5 (बचाव कौशल)"
            jump after_forest

label after_forest:
    narrator "जंगल से लौटते समय थकान महसूस होती है।"
    jump day_evening

label temple:
    scene bg_temple
    with fade
    show aryan normal at center
    narrator "मंदिर में शांति और मैजिक की ऊर्जा।"
    menu:
        "ध्यान लगाएं":
            $ magic_stat += 10
            narrator "मैजिक +10"
            jump after_temple
        "मीरा से मिलें":
            $ meera_love += 10
            meera "मंदिर में आपका इंतजार था।"
            jump after_temple

label after_temple:
    narrator "मंदिर से शांति लेकर लौटते हैं।"
    jump day_evening

label market:
    scene bg_market
    with fade
    show aryan normal at center
    narrator "बाज़ार में तरह-तरह की चीजें।"
    menu:
        "पोशन खरीदें":
            narrator "हीलिंग पोशन खरीदा।"
            jump after_market
        "एलेना से मिलें":
            $ elena_love += 5
            elena "क्या आप कुछ खरीदना चाहते हैं?"
            jump after_market

label after_market:
    narrator "बाज़ार की भीड़ से दूर लौटते हैं।"
    jump day_evening

label rest:
    scene black
    with fade
    narrator "आपने आराम किया और ऊर्जा वापस पा ली।"
    $ magic_stat += 5
    $ strength_stat += 5
    narrator "मैजिक +5, स्ट्रेंथ +5"
    jump day_afternoon

label night_choice:
    menu:
        "मीरा से बात करें":
            $ meera_love += 5
            meera "रात में बात करना अच्छा लगता है।"
            jump day_transition
        "लिला से बात करें":
            $ lila_love += 5
            lila "रात की बातें सबसे मजेदार होती हैं!"
            jump day_transition
        "एलेना से बात करें":
            $ elena_love += 5
            elena "रात में जादू की बातें करें।"
            jump day_transition
        "सो जाएं":
            jump day_transition

## ============================================================================
## ROUTE CHECKS & ENDINGS
## ============================================================================
label game_ending:
    scene black
    with fade
    narrator "30 दिन पूरे हो गए। Evenralm में आपकी कहानी का नतीजा।"

    if meera_love >= 50 and confessed_meera:
        jump ending_meera
    elif lila_love >= 50 and confessed_lila:
        jump ending_lila
    elif elena_love >= 50 and confessed_elena:
        jump ending_elena
    elif meera_love >= 30:
        jump ending_meera_friend
    elif lila_love >= 30:
        jump ending_lila_friend
    else:
        jump ending_solo

label ending_meera:
    scene bg_sunset_kiss
    with fade
    show aryan smile at left
    show meera smile at right
    meera "आर्यन, मैं तुमसे सच्चा प्यार करती हूं।"
    aryan "मैं भी, मीरा। हमेशा के लिए।"
    narrator "मेरा रूट — सच्चा प्यार।"
    jump ask_replay

label ending_lila:
    scene bg_village
    with fade
    show aryan smile at left
    show lila happy at right
    lila "आर्यन, हम हमेशा साथ रहेंगे, दोस्त बनकर!"
    aryan "हां लिला, हमेशा।"
    narrator "लिला रूट — गहरी दोस्ती।"
    jump ask_replay

label ending_elena:
    scene bg_guild
    with fade
    show aryan normal at left
    show elena smile at right
    elena "आर्यन, मैजिक की दुनिया में आपका स्वागत है, हमेशा के लिए।"
    narrator "एलेना रूट — मैजिक पार्टनर।"
    jump ask_replay

label ending_meera_friend:
    scene bg_village
    with fade
    show aryan smile at left
    show meera smile at right
    meera "आर्यन, तुम मेरे खास दोस्त हो।"
    narrator "मेरा मित्रता रूट।"
    jump ask_replay

label ending_lila_friend:
    scene bg_forest
    with fade
    show aryan smile at left
    show lila happy at right
    lila "सबसे अच्छे दोस्त, हमेशा के लिए!"
    narrator "लिला मित्रता रूट।"
    jump ask_replay

label ending_solo:
    scene black
    with fade
    show aryan normal at center
    aryan "मैंने अकेले Evenralm को समझा। मेरी अपनी राह है।"
    narrator "सोलो रूट — स्वतंत्र यात्री।"
    jump ask_replay

label ask_replay:
    menu:
        "दोबारा खेलें (नए रूट के साथ)":
            $ day = 1
            $ meera_love = 0
            $ lila_love = 0
            $ elena_love = 0
            $ magic_stat = 0
            $ strength_stat = 0
            $ charm_stat = 0
            jump start
        "खेल छोड़ें":
            return

    return