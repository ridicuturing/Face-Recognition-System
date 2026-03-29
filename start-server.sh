#!/bin/bash

echo "Installing dependencies..."
npm install

echo ""
echo "Starting server..."
echo "Server address: http://localhost:8080"
echo ""

node server/server.js
