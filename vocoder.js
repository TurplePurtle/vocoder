/// Silly polyfilling
window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;

/// Util functions
// query selector helper
function $(s,a,p) {
	if (typeof s !== "string") return s;
	p = p || document;
	return a ? p.querySelectorAll(s) : p.querySelector(s);
}
// sum the numbers in an array slice
function sumSlice(arr, a, b) {
	var sum = 0;
	for (var i = a; i < b; i++) {
		sum += arr[i];
	}
	return sum;
}
// graph a buffer on a given 2d canvas context
function graphBuffer(ctx, buff) {
	var n = buff.length,
		h = ctx.canvas.height;
	ctx.clearRect(0, 0, ctx.canvas.width, h);
	for (var i = 0; i < n; i++) {
		ctx.fillRect(i, h - buff[i] - 1, 1, buff[i]+1);
	}
}
// create a slider
function setInputChangeFn(sel, fn, val) {
	var el = $(sel);
	el.addEventListener("change", fn, false);
	if (val) el.value = val;
	fn.call(el);
}

/// Set up us the canvas
var ctxfft = $("#fft-graph").getContext("2d"); // (not jQuery)
ctxfft.canvas.width = 1024; // half the fftSize
ctxfft.canvas.height = 256;
ctxfft.fillStyle = "#9c3";

/// Set up us the audio
(function() {
	if (typeof AudioContext !== "function") {
		throw new Error("AudioContext not supported!");
	}
	
	/* Graph:
		microphone -->- analyser (-->- modify gains[] params)

		oscillator -->- filters[] -->- gains[] -->- output
		
		(note: filters are 2nd order)
	*/

	/// Graph nodes
	var
	mic,       // MediaStreamAudioSourceNode
	context    = new AudioContext,
	analyser   = context.createAnalyser(),
	gainNodes  = [],
	filters1   = [],
	filters2   = [],
	oscillator = context.createOscillator();


	/// Analyser (FFT) config
	analyser.fftSize = 2048; // fun fact: 2048 == 0x800
	analyser.smoothingTimeConstant = 0.65;
	var fftBuffer = new Uint8Array(analyser.frequencyBinCount);


	/// Vocoder config
	var numBands = 40;

	// freqBounds is an array of length (numBands + 1)
	// It defines the bounds for each band.
	// The bounds are spaced out logarithmically.
	var freqBounds = (function(freqStart, freqEnd, numBands) {
		var bounds = [];
		var pStart = Math.log(freqStart),
			pEnd = Math.log(freqEnd),
			pDel = (pEnd - pStart) / numBands;

		for (var i = 0; i < numBands; i++) {
			bounds.push(Math.exp(pStart + i * pDel));
		}
		bounds.push(freqEnd);
		return bounds;
	})(200, 4500, numBands);

	// nBounds contains the bounds for each band as indices of the FFT
	var nBounds = freqBounds.map(function(f) {
		return Math.round(f * analyser.fftSize / context.sampleRate);
	});

	// get the normalized power within each band
	function getSpectralPower(arr, bounds) {
		var power = [];
		var numBands = bounds.length - 1;
		
		// normalization constant
		var norm = Math.ceil(255 * (bounds[numBands] - bounds[numBands - 1]) *
			context.sampleRate / analyser.fftSize);

		for (var i = 0; i < numBands; i++) {
			power.push( sumSlice(arr, bounds[i], bounds[i+1]) / norm );
		}
		return power;
	}


	/// Nodes for each band
	for (var i = 0; i < numBands; i++) {
		var gainNode = context.createGainNode();
		var filter1 = context.createBiquadFilter();
		var filter2 = context.createBiquadFilter();
		var f0 = (freqBounds[i] + freqBounds[i+1]) / 2;
		var bandwidth = 0.5 * (freqBounds[i+1] - freqBounds[i]);

		/// Gain node
		gainNode.gain.value = 0;
		gainNode.connect(context.destination);
		gainNodes.push(gainNode);

		/// Second filter
		filter2.frequency.value = f0;
		filter2.Q.value = f0 / bandwidth;
		filter2.connect(gainNode);
		filters2.push(filter2);

		/// First filter
		filter1.frequency.value = f0;
		filter1.Q.value = f0 / bandwidth;
		filter1.connect(filter2);
		oscillator.connect(filter1);
		filters1.push(filter1);
	}

	/// Oscillator config
	oscillator.type = oscillator.SAWTOOTH;
	oscillator.frequency.value = 110; // Hz
	oscillator.noteOn(context.currentTime); // start oscillating

	/// Microphone
	navigator.getUserMedia({audio: true, video: false}, function(stream) {
		mic = context.createMediaStreamSource(stream);
		mic.connect(analyser);
	}, (console.warn||console.log).bind(console));


	/// Get FFT data
	// It would be nice if I didn't have to rely on setInterval
	// It causes problems when the tab loses focus
	setInterval(function() {
		var buffer = fftBuffer;

		analyser.getByteFrequencyData(buffer);

		/// graph the FFT
		graphBuffer(ctxfft, buffer);

		/// update bandpass params
		var gains = getSpectralPower(buffer, nBounds);
		for (var i = 0; i < numBands; i++) {
			gainNodes[i].gain.value = gains[i];
		}
	}, 15);


	/// Set up slider to change oscillator frequency
	setInputChangeFn("#oscf-slider", function() {
		var val = Math.pow(10, this.valueAsNumber / 23);
		oscillator.frequency.value = val;
		$("#oscf-disp").innerHTML = val.toPrecision(4);
	}, 47);


	/// Log FFT frequency on canvas click location
	ctxfft.canvas.addEventListener("click", function(e) {
		var x = e.offsetX;
		var freq = x * context.sampleRate / analyser.fftSize;
		console.log(freq);
	}, false);
})();
