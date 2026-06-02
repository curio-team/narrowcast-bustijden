<?php

const LOCALHOST = 'http://localhost:';
const GITHUB_PAGES = 'https://curio-team.github.io';

$http_origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if ($http_origin === GITHUB_PAGES || substr($http_origin, 0, strlen(LOCALHOST)) === LOCALHOST) {
    header("Access-Control-Allow-Origin: $http_origin");
    header('Access-Control-Allow-Methods: GET');
    header('Vary: Origin');
} else {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Forbidden']);
    exit;
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
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Bad Gateway']);
} else {
    header('Content-Type: application/json');
    echo $response;
}

curl_close($ch);
?>
