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
