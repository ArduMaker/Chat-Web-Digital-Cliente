<?php
/*
Plugin Name: AI Chatbot Widget
Description: Chat widget DigitalMTX.
Version: 9.0
Author: Ardumaker
*/

add_action('wp_enqueue_scripts', function () {
  $dir = plugin_dir_url(__FILE__) . 'assets/';
  $v   = '12.0';

  wp_enqueue_style(
    'cb-css',
    $dir . 'chatbot.css',
    [],
    $v
  );

  wp_enqueue_script('cb-api', $dir . 'chatbot_api.js', [], $v, true);
  wp_enqueue_script('cb-ui', $dir . 'chatbot_ui.js', ['cb-api'], $v, true);
  wp_enqueue_script('cb-ws', $dir . 'chatbot_ws.js', [], $v, true);
  wp_enqueue_script('cb-app', $dir . 'chatbot.js', ['cb-ui', 'cb-ws'], $v, true);

  // Runtime config for frontend API client.
  wp_localize_script('cb-api', 'DMTX_CHATBOT_CONFIG', [
    'apiBaseUrl' => 'https://apidigitalmtx.arducloud.com',
    'debug' => (defined('WP_DEBUG') && WP_DEBUG),
  ]);
});
