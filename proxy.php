<?php

const LOCALHOST = 'http://localhost:';

$http_origin = $_SERVER['HTTP_ORIGIN'];

if ($http_origin == 'https://curio-team.github.io' || substr($http_origin, 0, strlen(LOCALHOST)) === LOCALHOST)
{
    header("Access-Control-Allow-Origin: $http_origin");
}

$url = 'http://v0.ovapi.nl/stopareacode/';

if (isset($_GET['stopAreaCode'])) {
    $url .= urlencode($_GET['stopAreaCode']);
} else {
    $url .= 'BdOud';
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, false);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true); // Follow redirects
curl_setopt($ch, CURLOPT_HTTPGET, true); // Make a GET request

$response = curl_exec($ch);

if (curl_errno($ch)) {
    echo 'Curl error: ' . curl_error($ch);
} else {
    header('Content-Type: application/json');
    echo $response;
}

curl_close($ch);
?>
