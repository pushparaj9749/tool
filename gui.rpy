## Isekai Paradise - GUI
## Ren'Py GUI configuration

init python:
    style.window.background = None
    style.window.xpadding = 40
    style.window.ypadding = 40
    style.window.left_margin = 40
    style.window.right_margin = 40
    style.window.top_margin = 40
    style.window.bottom_margin = 40

    style.say_dialogue.background = Frame("gui/dialogue_frame.png", 10, 10)
    style.say_dialogue.left_padding = 40
    style.say_dialogue.right_padding = 40
    style.say_dialogue.top_padding = 20
    style.say_dialogue.bottom_padding = 20

    style.say_who_window.background = Frame("gui/namebox_frame.png", 10, 10)
    style.say_who_window.xalign = 0.0
    style.say_who_window.xmaximum = 1.0
    style.say_who_window.xminimum = 0.0
    style.say_who_window.left_padding = 20
    style.say_who_window.right_padding = 20
    style.say_who_window.top_padding = 5
    style.say_who_window.bottom_padding = 5

    style.say_who.text_color = "#ffffff"
    style.say_who.xalign = 0.0

    style.say_dialogue_vbox.spacing = 5

    style.say_menu_choice.text_color = "#ffffff"
    style.say_menu_choice.hover_color = "#ff69b4"

    style.say_text.text_color = "#eeeeee"

    style.choice.text_color = "#ffffff"
    style.choice.hover_color = "#ff69b4"
