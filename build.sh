#!/bin/sh
# Собирает автономный HTML-фрагмент (стили и скрипты внутри) для публикации демо.
cd "$(dirname "$0")"
mkdir -p dist
{
  sed -n '/<title>/p;/fonts.googleapis.com\/css2/p' index.html
  echo '<style>'; cat styles.css; echo '</style>'
  echo '<div id="app"></div>'
  for f in data.js engine.js app.js; do echo '<script>'; cat $f; echo '</script>'; done
} > dist/collections.html
echo "dist/collections.html"
