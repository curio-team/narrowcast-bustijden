# Narrowcast Bustijden

![Narrowcast Bustijden](./assets/readme-logo.png)

Bus tijden voor de bushaltes in de buurt van onze school. Gemaakt voor de narrowcast schermen in de school.

## API

De API waar we gebruik van maken is de [`ovapi`](http://v0.ovapi.nl/stopareacode/BdOud). We maken gebruik van [een proxy server](http://bustijden.curio.codes/) (zie `proxy.php`) om deze HTTP-API naar HTTPS om te zetten en om onze eigen `CORS` headers toe te voegen.

## Gebruik

1. Clone de repository

2. Om te zorgen dat de test-data kan laden, moet je het project hosten op localhost. Gebruik bijvoorbeeld de [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extensie in Visual Studio Code.

3. Open de site in je browser

Zie het commentaar in de `index.html` voor meer informatie.

## Andere routes

Standaard wordt de route `BdOud` gebruikt. Je kunt dit aanpassen door de `stopAreaCode` in de URL aan te passen:

```
?stopAreaCode=BdLov
```

Als je de ook de volgorde van haltes (welke boven of onder staat) wilt aanpassen kun je `routeA` en `routeB` aangeven:

```
?stopAreaCode=BdLov&routeA=72001080&routeB=72001330
```

Gebruik de [ovapi](http://v0.ovapi.nl/stopareacode) om alle bushaltes in de buurt van jouw locatie te vinden. Vervolgens staan de `routeA` en `routeB` codes onder de root stopAreaCode node.

## Procedurele 3D-scène

De halte, bussen, studenten, kleding en feestdagdecoraties worden opgebouwd uit eenvoudige 3D-vormen in
`js/models3d.js`. `js/scene3d.js` tekent deze met WebGL 2 en een orthografische camera onder een isometrische
hoek. De PNG-bestanden zijn alleen nog referentiemateriaal; de scène laadt geen sprites of texturen.
Three.js 0.182.0 staat lokaal in `js/vendor/`, inclusief MIT-licentie. De site heeft geen buildstap nodig.

Voor narrowcastschermen is de animatie begrensd op 30 fps en maximaal 1920 × 1080 renderpixels, ook op
een 4K-scherm. Gedeelde geometrie en GPU-instancing houden het aantal draw calls klein bij grote groepen.
De wachtrij is begrensd op 300 studenten per richting; vertrokken bussen en ingestapte studenten worden
verwijderd. Animatielussen pauzeren wanneer het tabblad verborgen is. Regen, sneeuw en vuurwerk blijven
lichte canvasdeeltjes. Zonder WebGL 2 blijven de vertrektijden beschikbaar.

Inspecteer `scene3d.getStats()` in de browserconsole voor draw calls, driehoeken, GPU-resources en
renderresolutie. Gebruik bijvoorbeeld `?fakeTime=2026-11-20T12:00:00%2B01:00` op localhost om Sinterklaas
te bekijken. Feestdagen blijven geregistreerd in `js/events/`; decoraties en kleding verwijzen nu naar
`model` en `models` in plaats van afbeeldingsbestanden. Posities gebruiken vaste layoutcoördinaten,
zodat een resize bestaande animaties niet verplaatst.

De browsertest controleert onder meer 600 zichtbare studenten, feestdagwisselingen, opruimen van
animaties, portret/4K-resizes en pauzeren bij een verborgen tabblad:

```sh
npm ci
npx playwright install chromium
npm test
```

Met `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` kun je een bestaande Chromium-installatie gebruiken.
De bestaande Vue- en Tailwind-CDN's moeten bereikbaar zijn tijdens de test.
