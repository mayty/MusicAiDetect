

generate_icon:
ifndef SIZE
	$(error) "SIZE env variable not defined"
endif
	rsvg-convert -w $(SIZE) -h $(SIZE) "icon_source/logo.svg" -o "dist/$(SIZE).png"


generate_icons:
	SIZE=128 $(MAKE) generate_icon
	SIZE=48  $(MAKE) generate_icon
	SIZE=32  $(MAKE) generate_icon
	SIZE=16  $(MAKE) generate_icon
	rsvg-convert                                           \
		-w 96 -h 96                                        \
		--page-height 128 --page-width 128                 \
		--left 16 --top 16                                 \
		"icon_source/logo.svg" -o "listing/store_icon.png"


package:
	zip -r dist.zip dist
