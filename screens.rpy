## Isekai Paradise - Screens
## Ren'Py Screens configuration

init python:
    pass

screen say(who, what):
    style_prefix "say"

    window:
        id "window"

        vbox:
            id "vbox"
            spacing: 5

            if who:
                window:
                    id "who_window"
                    xalign 0.0
                    xmaximum 1.0
                    text who id "who" xalign 0.0

            text what id "what"
