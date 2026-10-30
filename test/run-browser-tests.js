/* jshint node: true, es3: false */
/*
 * CI-only runner for the QUnit browser suite (test/index.html) in headless Chrome.
 * Loads the page from a PHP-enabled server (the ajax tests need test/data/*.php),
 * waits for QUnit to finish, then prints every test's result plus a summary.
 * Needs a modern Node and puppeteer-core (resolved via NODE_PATH).
 *
 * Usage: node test/run-browser-tests.js http://127.0.0.1:8000/test/index.html
 */
"use strict";

var puppeteer = require( "puppeteer-core" ),
	pageUrl = process.argv[ 2 ] || "http://127.0.0.1:8000/test/index.html",
	timeout = 30 * 60 * 1000,
	browser, page, progress,

	// Tests the unit files skip when navigator.webdriver is set (see the comment at each one)
	skipped = [
		[ "support", "Check CSP (https://developer.mozilla.org/en-US/docs/Security/CSP) restrictions",
			"modern Chrome reports the support probe's setAttribute(\"onfocusin\") as a CSP inline-handler violation" ],
		[ "ajax", "#14379 - jQuery.ajax() on unload",
			"Chrome 80+ refuses synchronous XHR during page dismissal" ],
		[ "offset", "fractions (see #7730 and #7885)",
			"modern Chrome lays out in 1/64px units, so offset() reads back 999.984375 instead of 1000" ]
	];

function report( results ) {
	var failedTests = 0,
		skippedTests = 0;

	results.tests.forEach(function( r ) {
		if ( r.failed > 0 ) {
			failedTests++;
		}
		console.log( ( r.failed > 0 ? "FAIL" : "PASS" ) + " [" + r.module + "] " + r.name +
			" (" + r.passed + " passed, " + r.failed + " failed)" );
		r.messages.forEach(function( m ) {
			console.log( "    - " + m );
		});
	});

	console.log( "" );
	console.log( "Skipped tests (disabled in the test source under navigator.webdriver, i.e. this headless-Chrome run):" );
	skipped.forEach(function( s ) {
		var ran = results.tests.some(function( r ) {
			return r.module === s[ 0 ] && r.name === s[ 1 ];
		});
		if ( !ran ) {
			skippedTests++;
		}
		console.log( ( ran ? "NOT SKIPPED" : "SKIP" ) + " [" + s[ 0 ] + "] " + s[ 1 ] + " -- reason: " + s[ 2 ] );
	});

	console.log( "" );
	console.log( "QUnit summary: " + results.summary );
	console.log( "Tests: " + results.tests.length + " total, " +
		( results.tests.length - failedTests ) + " passed, " + failedTests + " failed, " +
		skippedTests + " skipped" );
	return failedTests;
}

function collect() {
	var out = [],
		items = document.querySelectorAll( "#qunit-tests > li" );

	Array.prototype.forEach.call( items, function( li ) {
		var mod = li.querySelector( ".module-name" ),
			name = li.querySelector( ".test-name" ),
			failed = li.querySelector( ".counts .failed" ),
			passed = li.querySelector( ".counts .passed" ),
			msgs = [];

		Array.prototype.forEach.call( li.querySelectorAll( "ol > li.fail" ), function( a ) {
			msgs.push( a.textContent.replace( /\s+/g, " " ).slice( 0, 400 ) );
		});
		out.push({
			module: mod ? mod.textContent : "",
			name: name ? name.textContent : li.textContent.slice( 0, 100 ),
			failed: failed ? +failed.textContent : 0,
			passed: passed ? +passed.textContent : 0,
			messages: msgs
		});
	});
	return {
		tests: out,
		summary: document.getElementById( "qunit-testresult" ).textContent
	};
}

function resultText() {
	var el = document.getElementById( "qunit-testresult" );
	return el ? el.textContent : "(no result element yet)";
}

function finished() {
	var el = document.getElementById( "qunit-testresult" );
	return el && /Tests completed/.test( el.textContent );
}

puppeteer.launch({
	executablePath: process.env.CHROME_BIN || "google-chrome",
	headless: "new",
	args: [ "--no-sandbox", "--disable-gpu", "--window-size=1280,1024" ]
}).then(function( b ) {
	browser = b;
	return browser.newPage();
}).then(function( p ) {
	page = p;
	page.on( "pageerror", function( e ) {
		console.log( "[pageerror] " + e.message );
	});
	page.on( "dialog", function( d ) {
		d.dismiss();
	});
	return page.setViewport({ width: 1280, height: 1024 });
}).then(function() {
	console.log( "Opening " + pageUrl );
	return page.goto( pageUrl, { waitUntil: "load", timeout: 120000 } );
}).then(function() {
	// Keep the CI log alive while the suite runs
	progress = setInterval(function() {
		page.evaluate( resultText ).then(function( text ) {
			console.log( "[progress] " + text.slice( 0, 200 ) );
		}, function() {} );
	}, 30000 );
	return page.waitForFunction( finished, { timeout: timeout, polling: 1000 } );
}).then(function() {
	clearInterval( progress );
	return page.evaluate( collect );
}).then(function( results ) {
	var failedTests = report( results );
	return browser.close().then(function() {
		process.exit( failedTests > 0 ? 1 : 0 );
	});
}).catch(function( e ) {
	console.error( e );
	process.exit( 2 );
});
