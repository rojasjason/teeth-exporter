// ==UserScript==
// @name         Teeth Exporter (unofficial)
// @namespace    https://github.com/rojasjason/teeth-exporter
// @version      1.0.0
// @description  Export your own teeth + gums as STL/GLB from your aligner's 3D treatment-plan viewer. Unofficial; runs entirely in your browser.
// @author       Jason Rojas
// @homepageURL  https://github.com/rojasjason/teeth-exporter
// @supportURL   https://github.com/rojasjason/teeth-exporter/issues
// @match        *://*.invisalign.com/*
// @match        *://*.aligntech.com/*
// @match        *://*.clincheck.com/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/rojasjason/teeth-exporter/main/dist/teeth-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/rojasjason/teeth-exporter/main/dist/teeth-exporter.user.js
// @license      CC-BY-NC-SA-4.0
// ==/UserScript==

(function () {
"use strict";
/* Bundled by build/build_userscript.js — do not edit dist/ directly; edit src/ + lib/ and rebuild. */

/* ===================== lib/lzma.js ===================== */

var LZMA = LZMA || {};

// browserify support
if ( typeof module === 'object' ) {

	module.exports = LZMA;

}

LZMA.OutWindow = function() {
	this._windowSize = 0;
};

LZMA.OutWindow.prototype.create = function(windowSize) {
	if ( (!this._buffer) || (this._windowSize !== windowSize) ) {
		this._buffer = [];
	}
	this._windowSize = windowSize;
	this._pos = 0;
	this._streamPos = 0;
};

LZMA.OutWindow.prototype.flush = function() {
	var size = this._pos - this._streamPos;
	if (size !== 0) {
		while (size --) {
			this._stream.writeByte(this._buffer[this._streamPos ++]);
		}
		if (this._pos >= this._windowSize) {
			this._pos = 0;
		}
		this._streamPos = this._pos;
	}
};

LZMA.OutWindow.prototype.releaseStream = function() {
	this.flush();
	this._stream = null;
};

LZMA.OutWindow.prototype.setStream = function(stream) {
	this.releaseStream();
	this._stream = stream;
};

LZMA.OutWindow.prototype.init = function(solid) {
	if (!solid) {
		this._streamPos = 0;
		this._pos = 0;
	}
};

LZMA.OutWindow.prototype.copyBlock = function(distance, len) {
	var pos = this._pos - distance - 1;
	if (pos < 0) {
		pos += this._windowSize;
	}
	while (len --) {
		if (pos >= this._windowSize) {
			pos = 0;
		}
		this._buffer[this._pos ++] = this._buffer[pos ++];
		if (this._pos >= this._windowSize) {
			this.flush();
		}
	}
};

LZMA.OutWindow.prototype.putByte = function(b) {
	this._buffer[this._pos ++] = b;
	if (this._pos >= this._windowSize) {
		this.flush();
	}
};

LZMA.OutWindow.prototype.getByte = function(distance) {
	var pos = this._pos - distance - 1;
	if (pos < 0) {
		pos += this._windowSize;
	}
	return this._buffer[pos];
};

LZMA.RangeDecoder = function() {
};

LZMA.RangeDecoder.prototype.setStream = function(stream) {
	this._stream = stream;
};

LZMA.RangeDecoder.prototype.releaseStream = function() {
	this._stream = null;
};

LZMA.RangeDecoder.prototype.init = function() {
	var i = 5;

	this._code = 0;
	this._range = -1;

	while (i --) {
		this._code = (this._code << 8) | this._stream.readByte();
	}
};

LZMA.RangeDecoder.prototype.decodeDirectBits = function(numTotalBits) {
	var result = 0, i = numTotalBits, t;

	while (i --) {
		this._range >>>= 1;
		t = (this._code - this._range) >>> 31;
		this._code -= this._range & (t - 1);
		result = (result << 1) | (1 - t);

		if ( (this._range & 0xff000000) === 0) {
			this._code = (this._code << 8) | this._stream.readByte();
			this._range <<= 8;
		}
	}

	return result;
};

LZMA.RangeDecoder.prototype.decodeBit = function(probs, index) {
	var prob = probs[index],
      newBound = (this._range >>> 11) * prob;

	if ( (this._code ^ 0x80000000) < (newBound ^ 0x80000000) ) {
		this._range = newBound;
		probs[index] += (2048 - prob) >>> 5;
		if ( (this._range & 0xff000000) === 0) {
			this._code = (this._code << 8) | this._stream.readByte();
			this._range <<= 8;
		}
		return 0;
	}

	this._range -= newBound;
	this._code -= newBound;
	probs[index] -= prob >>> 5;
	if ( (this._range & 0xff000000) === 0) {
		this._code = (this._code << 8) | this._stream.readByte();
		this._range <<= 8;
	}
	return 1;
};

LZMA.initBitModels = function(probs, len) {
	while (len --) {
		probs[len] = 1024;
	}
};

LZMA.BitTreeDecoder = function(numBitLevels) {
	this._models = [];
	this._numBitLevels = numBitLevels;
};

LZMA.BitTreeDecoder.prototype.init = function() {
	LZMA.initBitModels(this._models, 1 << this._numBitLevels);
};

LZMA.BitTreeDecoder.prototype.decode = function(rangeDecoder) {
	var m = 1, i = this._numBitLevels;

	while (i --) {
		m = (m << 1) | rangeDecoder.decodeBit(this._models, m);
	}
	return m - (1 << this._numBitLevels);
};

LZMA.BitTreeDecoder.prototype.reverseDecode = function(rangeDecoder) {
	var m = 1, symbol = 0, i = 0, bit;

	for (; i < this._numBitLevels; ++ i) {
		bit = rangeDecoder.decodeBit(this._models, m);
		m = (m << 1) | bit;
		symbol |= bit << i;
	}
	return symbol;
};

LZMA.reverseDecode2 = function(models, startIndex, rangeDecoder, numBitLevels) {
	var m = 1, symbol = 0, i = 0, bit;

	for (; i < numBitLevels; ++ i) {
		bit = rangeDecoder.decodeBit(models, startIndex + m);
		m = (m << 1) | bit;
		symbol |= bit << i;
	}
	return symbol;
};

LZMA.LenDecoder = function() {
	this._choice = [];
	this._lowCoder = [];
	this._midCoder = [];
	this._highCoder = new LZMA.BitTreeDecoder(8);
	this._numPosStates = 0;
};

LZMA.LenDecoder.prototype.create = function(numPosStates) {
	for (; this._numPosStates < numPosStates; ++ this._numPosStates) {
		this._lowCoder[this._numPosStates] = new LZMA.BitTreeDecoder(3);
		this._midCoder[this._numPosStates] = new LZMA.BitTreeDecoder(3);
	}
};

LZMA.LenDecoder.prototype.init = function() {
	var i = this._numPosStates;
	LZMA.initBitModels(this._choice, 2);
	while (i --) {
		this._lowCoder[i].init();
		this._midCoder[i].init();
	}
	this._highCoder.init();
};

LZMA.LenDecoder.prototype.decode = function(rangeDecoder, posState) {
	if (rangeDecoder.decodeBit(this._choice, 0) === 0) {
		return this._lowCoder[posState].decode(rangeDecoder);
	}
	if (rangeDecoder.decodeBit(this._choice, 1) === 0) {
		return 8 + this._midCoder[posState].decode(rangeDecoder);
	}
	return 16 + this._highCoder.decode(rangeDecoder);
};

LZMA.Decoder2 = function() {
	this._decoders = [];
};

LZMA.Decoder2.prototype.init = function() {
	LZMA.initBitModels(this._decoders, 0x300);
};

LZMA.Decoder2.prototype.decodeNormal = function(rangeDecoder) {
	var symbol = 1;

	do {
		symbol = (symbol << 1) | rangeDecoder.decodeBit(this._decoders, symbol);
	}while (symbol < 0x100);

	return symbol & 0xff;
};

LZMA.Decoder2.prototype.decodeWithMatchByte = function(rangeDecoder, matchByte) {
	var symbol = 1, matchBit, bit;

	do {
		matchBit = (matchByte >> 7) & 1;
		matchByte <<= 1;
		bit = rangeDecoder.decodeBit(this._decoders, ( (1 + matchBit) << 8) + symbol);
		symbol = (symbol << 1) | bit;
		if (matchBit !== bit) {
			while (symbol < 0x100) {
				symbol = (symbol << 1) | rangeDecoder.decodeBit(this._decoders, symbol);
			}
			break;
		}
	}while (symbol < 0x100);

	return symbol & 0xff;
};

LZMA.LiteralDecoder = function() {
};

LZMA.LiteralDecoder.prototype.create = function(numPosBits, numPrevBits) {
	var i;

	if (this._coders
    && (this._numPrevBits === numPrevBits)
    && (this._numPosBits === numPosBits) ) {
		return;
	}
	this._numPosBits = numPosBits;
	this._posMask = (1 << numPosBits) - 1;
	this._numPrevBits = numPrevBits;

	this._coders = [];

	i = 1 << (this._numPrevBits + this._numPosBits);
	while (i --) {
		this._coders[i] = new LZMA.Decoder2();
	}
};

LZMA.LiteralDecoder.prototype.init = function() {
	var i = 1 << (this._numPrevBits + this._numPosBits);
	while (i --) {
		this._coders[i].init();
	}
};

LZMA.LiteralDecoder.prototype.getDecoder = function(pos, prevByte) {
	return this._coders[( (pos & this._posMask) << this._numPrevBits)
    + ( (prevByte & 0xff) >>> (8 - this._numPrevBits) )];
};

LZMA.Decoder = function() {
	this._outWindow = new LZMA.OutWindow();
	this._rangeDecoder = new LZMA.RangeDecoder();
	this._isMatchDecoders = [];
	this._isRepDecoders = [];
	this._isRepG0Decoders = [];
	this._isRepG1Decoders = [];
	this._isRepG2Decoders = [];
	this._isRep0LongDecoders = [];
	this._posSlotDecoder = [];
	this._posDecoders = [];
	this._posAlignDecoder = new LZMA.BitTreeDecoder(4);
	this._lenDecoder = new LZMA.LenDecoder();
	this._repLenDecoder = new LZMA.LenDecoder();
	this._literalDecoder = new LZMA.LiteralDecoder();
	this._dictionarySize = -1;
	this._dictionarySizeCheck = -1;

	this._posSlotDecoder[0] = new LZMA.BitTreeDecoder(6);
	this._posSlotDecoder[1] = new LZMA.BitTreeDecoder(6);
	this._posSlotDecoder[2] = new LZMA.BitTreeDecoder(6);
	this._posSlotDecoder[3] = new LZMA.BitTreeDecoder(6);
};

LZMA.Decoder.prototype.setDictionarySize = function(dictionarySize) {
	if (dictionarySize < 0) {
		return false;
	}
	if (this._dictionarySize !== dictionarySize) {
		this._dictionarySize = dictionarySize;
		this._dictionarySizeCheck = Math.max(this._dictionarySize, 1);
		this._outWindow.create( Math.max(this._dictionarySizeCheck, 4096) );
	}
	return true;
};

LZMA.Decoder.prototype.setLcLpPb = function(lc, lp, pb) {
	var numPosStates = 1 << pb;

	if (lc > 8 || lp > 4 || pb > 4) {
		return false;
	}

	this._literalDecoder.create(lp, lc);

	this._lenDecoder.create(numPosStates);
	this._repLenDecoder.create(numPosStates);
	this._posStateMask = numPosStates - 1;

	return true;
};

LZMA.Decoder.prototype.init = function() {
	var i = 4;

	this._outWindow.init(false);

	LZMA.initBitModels(this._isMatchDecoders, 192);
	LZMA.initBitModels(this._isRep0LongDecoders, 192);
	LZMA.initBitModels(this._isRepDecoders, 12);
	LZMA.initBitModels(this._isRepG0Decoders, 12);
	LZMA.initBitModels(this._isRepG1Decoders, 12);
	LZMA.initBitModels(this._isRepG2Decoders, 12);
	LZMA.initBitModels(this._posDecoders, 114);

	this._literalDecoder.init();

	while (i --) {
		this._posSlotDecoder[i].init();
	}

	this._lenDecoder.init();
	this._repLenDecoder.init();
	this._posAlignDecoder.init();
	this._rangeDecoder.init();
};

LZMA.Decoder.prototype.decode = function(inStream, outStream, outSize) {
	var state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, nowPos64 = 0, prevByte = 0,
      posState, decoder2, len, distance, posSlot, numDirectBits;

	this._rangeDecoder.setStream(inStream);
	this._outWindow.setStream(outStream);

	this.init();

	while (outSize < 0 || nowPos64 < outSize) {
		posState = nowPos64 & this._posStateMask;

		if (this._rangeDecoder.decodeBit(this._isMatchDecoders, (state << 4) + posState) === 0) {
			decoder2 = this._literalDecoder.getDecoder(nowPos64 ++, prevByte);

			if (state >= 7) {
				prevByte = decoder2.decodeWithMatchByte(this._rangeDecoder, this._outWindow.getByte(rep0) );
			}else {
				prevByte = decoder2.decodeNormal(this._rangeDecoder);
			}
			this._outWindow.putByte(prevByte);

			state = state < 4 ? 0 : state - (state < 10 ? 3 : 6);

		}else {

			if (this._rangeDecoder.decodeBit(this._isRepDecoders, state) === 1) {
				len = 0;
				if (this._rangeDecoder.decodeBit(this._isRepG0Decoders, state) === 0) {
					if (this._rangeDecoder.decodeBit(this._isRep0LongDecoders, (state << 4) + posState) === 0) {
						state = state < 7 ? 9 : 11;
						len = 1;
					}
				}else {
					if (this._rangeDecoder.decodeBit(this._isRepG1Decoders, state) === 0) {
						distance = rep1;
					}else {
						if (this._rangeDecoder.decodeBit(this._isRepG2Decoders, state) === 0) {
							distance = rep2;
						}else {
							distance = rep3;
							rep3 = rep2;
						}
						rep2 = rep1;
					}
					rep1 = rep0;
					rep0 = distance;
				}
				if (len === 0) {
					len = 2 + this._repLenDecoder.decode(this._rangeDecoder, posState);
					state = state < 7 ? 8 : 11;
				}
			}else {
				rep3 = rep2;
				rep2 = rep1;
				rep1 = rep0;

				len = 2 + this._lenDecoder.decode(this._rangeDecoder, posState);
				state = state < 7 ? 7 : 10;

				posSlot = this._posSlotDecoder[len <= 5 ? len - 2 : 3].decode(this._rangeDecoder);
				if (posSlot >= 4) {

					numDirectBits = (posSlot >> 1) - 1;
					rep0 = (2 | (posSlot & 1) ) << numDirectBits;

					if (posSlot < 14) {
						rep0 += LZMA.reverseDecode2(this._posDecoders,
                rep0 - posSlot - 1, this._rangeDecoder, numDirectBits);
					}else {
						rep0 += this._rangeDecoder.decodeDirectBits(numDirectBits - 4) << 4;
						rep0 += this._posAlignDecoder.reverseDecode(this._rangeDecoder);
						if (rep0 < 0) {
							if (rep0 === -1) {
								break;
							}
							return false;
						}
					}
				}else {
					rep0 = posSlot;
				}
			}

			if (rep0 >= nowPos64 || rep0 >= this._dictionarySizeCheck) {
				return false;
			}

			this._outWindow.copyBlock(rep0, len);
			nowPos64 += len;
			prevByte = this._outWindow.getByte(0);
		}
	}

	this._outWindow.flush();
	this._outWindow.releaseStream();
	this._rangeDecoder.releaseStream();

	return true;
};

LZMA.Decoder.prototype.setDecoderProperties = function(properties) {
	var value, lc, lp, pb, dictionarySize;

	if (properties.size < 5) {
		return false;
	}

	value = properties.readByte();
	lc = value % 9;
	value = ~~(value / 9);
	lp = value % 5;
	pb = ~~(value / 5);

	if ( !this.setLcLpPb(lc, lp, pb) ) {
		return false;
	}

	dictionarySize = properties.readByte();
	dictionarySize |= properties.readByte() << 8;
	dictionarySize |= properties.readByte() << 16;
	dictionarySize += properties.readByte() * 16777216;

	return this.setDictionarySize(dictionarySize);
};

LZMA.decompress = function(properties, inStream, outStream, outSize) {
	var decoder = new LZMA.Decoder();

	if ( !decoder.setDecoderProperties(properties) ) {
		throw "Incorrect stream properties";
	}

	if ( !decoder.decode(inStream, outStream, outSize) ) {
		throw "Error in data stream";
	}

	return true;
};

if (typeof globalThis !== "undefined") globalThis.LZMA = LZMA;



/* ===================== lib/ctm.js ===================== */
/*
Copyright (c) 2011 Juan Mellado

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/*
References:
- "OpenCTM: The Open Compressed Triangle Mesh file format" by Marcus Geelnard
  http://openctm.sourceforge.net/
*/

// Patched for dual node/browser use: require() in node, global LZMA in the browser
// (lib/lzma.js must be loaded first as a classic script so globalThis.LZMA exists).
var LZMA = (typeof require === 'function')
	? require('./lzma')
	: (typeof globalThis !== 'undefined' ? globalThis.LZMA : LZMA);

var CTM = CTM || {};

// browserify support
if ( typeof module === 'object' ) {

	module.exports = CTM;

}

CTM.CompressionMethod = {
  RAW: 0x00574152,
  MG1: 0x0031474d,
  MG2: 0x0032474d
};

CTM.Flags = {
  NORMALS: 0x00000001
};

CTM.File = function(stream) {
	this.load(stream);
};

CTM.File.prototype.load = function(stream) {
	this.header = new CTM.FileHeader(stream);

	this.body = new CTM.FileBody(this.header);

	this.getReader().read(stream, this.body);
};

CTM.File.prototype.getReader = function() {
	var reader;

	switch (this.header.compressionMethod){
		case CTM.CompressionMethod.RAW:
			reader = new CTM.ReaderRAW();
			break;
		case CTM.CompressionMethod.MG1:
			reader = new CTM.ReaderMG1();
			break;
		case CTM.CompressionMethod.MG2:
			reader = new CTM.ReaderMG2();
			break;
	}

	return reader;
};

CTM.FileHeader = function(stream) {
	stream.readInt32(); //magic "OCTM"
	this.fileFormat = stream.readInt32();
	this.compressionMethod = stream.readInt32();
	this.vertexCount = stream.readInt32();
	this.triangleCount = stream.readInt32();
	this.uvMapCount = stream.readInt32();
	this.attrMapCount = stream.readInt32();
	this.flags = stream.readInt32();
	this.comment = stream.readString();
};

CTM.FileHeader.prototype.hasNormals = function() {
	return this.flags & CTM.Flags.NORMALS;
};

CTM.FileBody = function(header) {
	var i = header.triangleCount * 3,
      v = header.vertexCount * 3,
      n = header.hasNormals() ? header.vertexCount * 3 : 0,
      u = header.vertexCount * 2,
      a = header.vertexCount * 4,
      j = 0;

	var data = new ArrayBuffer(
    (i + v + n + (u * header.uvMapCount) + (a * header.attrMapCount) ) * 4);

	this.indices = new Uint32Array(data, 0, i);

	this.vertices = new Float32Array(data, i * 4, v);

	if ( header.hasNormals() ) {
		this.normals = new Float32Array(data, (i + v) * 4, n);
	}

	if (header.uvMapCount) {
		this.uvMaps = [];
		for (j = 0; j < header.uvMapCount; ++ j) {
			this.uvMaps[j] = { uv: new Float32Array(data,
        (i + v + n + (j * u) ) * 4, u) };
		}
	}

	if (header.attrMapCount) {
		this.attrMaps = [];
		for (j = 0; j < header.attrMapCount; ++ j) {
			this.attrMaps[j] = { attr: new Float32Array(data,
        (i + v + n + (u * header.uvMapCount) + (j * a) ) * 4, a) };
		}
	}
};

CTM.FileMG2Header = function(stream) {
	stream.readInt32(); //magic "MG2H"
	this.vertexPrecision = stream.readFloat32();
	this.normalPrecision = stream.readFloat32();
	this.lowerBoundx = stream.readFloat32();
	this.lowerBoundy = stream.readFloat32();
	this.lowerBoundz = stream.readFloat32();
	this.higherBoundx = stream.readFloat32();
	this.higherBoundy = stream.readFloat32();
	this.higherBoundz = stream.readFloat32();
	this.divx = stream.readInt32();
	this.divy = stream.readInt32();
	this.divz = stream.readInt32();

	this.sizex = (this.higherBoundx - this.lowerBoundx) / this.divx;
	this.sizey = (this.higherBoundy - this.lowerBoundy) / this.divy;
	this.sizez = (this.higherBoundz - this.lowerBoundz) / this.divz;
};

CTM.ReaderRAW = function() {
};

CTM.ReaderRAW.prototype.read = function(stream, body) {
	this.readIndices(stream, body.indices);
	this.readVertices(stream, body.vertices);

	if (body.normals) {
		this.readNormals(stream, body.normals);
	}
	if (body.uvMaps) {
		this.readUVMaps(stream, body.uvMaps);
	}
	if (body.attrMaps) {
		this.readAttrMaps(stream, body.attrMaps);
	}
};

CTM.ReaderRAW.prototype.readIndices = function(stream, indices) {
	stream.readInt32(); //magic "INDX"
	stream.readArrayInt32(indices);
};

CTM.ReaderRAW.prototype.readVertices = function(stream, vertices) {
	stream.readInt32(); //magic "VERT"
	stream.readArrayFloat32(vertices);
};

CTM.ReaderRAW.prototype.readNormals = function(stream, normals) {
	stream.readInt32(); //magic "NORM"
	stream.readArrayFloat32(normals);
};

CTM.ReaderRAW.prototype.readUVMaps = function(stream, uvMaps) {
	var i = 0;
	for (; i < uvMaps.length; ++ i) {
		stream.readInt32(); //magic "TEXC"

		uvMaps[i].name = stream.readString();
		uvMaps[i].filename = stream.readString();
		stream.readArrayFloat32(uvMaps[i].uv);
	}
};

CTM.ReaderRAW.prototype.readAttrMaps = function(stream, attrMaps) {
	var i = 0;
	for (; i < attrMaps.length; ++ i) {
		stream.readInt32(); //magic "ATTR"

		attrMaps[i].name = stream.readString();
		stream.readArrayFloat32(attrMaps[i].attr);
	}
};

CTM.ReaderMG1 = function() {
};

CTM.ReaderMG1.prototype.read = function(stream, body) {
	this.readIndices(stream, body.indices);
	this.readVertices(stream, body.vertices);

	if (body.normals) {
		this.readNormals(stream, body.normals);
	}
	if (body.uvMaps) {
		this.readUVMaps(stream, body.uvMaps);
	}
	if (body.attrMaps) {
		this.readAttrMaps(stream, body.attrMaps);
	}
};

CTM.ReaderMG1.prototype.readIndices = function(stream, indices) {
	stream.readInt32(); //magic "INDX"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(indices, 3);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

	CTM.restoreIndices(indices, indices.length);
};

CTM.ReaderMG1.prototype.readVertices = function(stream, vertices) {
	stream.readInt32(); //magic "VERT"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(vertices, 1);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);
};

CTM.ReaderMG1.prototype.readNormals = function(stream, normals) {
	stream.readInt32(); //magic "NORM"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(normals, 3);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);
};

CTM.ReaderMG1.prototype.readUVMaps = function(stream, uvMaps) {
	var i = 0;
	for (; i < uvMaps.length; ++ i) {
		stream.readInt32(); //magic "TEXC"

		uvMaps[i].name = stream.readString();
		uvMaps[i].filename = stream.readString();

		stream.readInt32(); //packed size

		var interleaved = new CTM.InterleavedStream(uvMaps[i].uv, 2);
		LZMA.decompress(stream, stream, interleaved, interleaved.data.length);
	}
};

CTM.ReaderMG1.prototype.readAttrMaps = function(stream, attrMaps) {
	var i = 0;
	for (; i < attrMaps.length; ++ i) {
		stream.readInt32(); //magic "ATTR"

		attrMaps[i].name = stream.readString();

		stream.readInt32(); //packed size

		var interleaved = new CTM.InterleavedStream(attrMaps[i].attr, 4);
		LZMA.decompress(stream, stream, interleaved, interleaved.data.length);
	}
};

CTM.ReaderMG2 = function() {
};

CTM.ReaderMG2.prototype.read = function(stream, body) {
	this.MG2Header = new CTM.FileMG2Header(stream);

	this.readVertices(stream, body.vertices);
	this.readIndices(stream, body.indices);

	if (body.normals) {
		this.readNormals(stream, body);
	}
	if (body.uvMaps) {
		this.readUVMaps(stream, body.uvMaps);
	}
	if (body.attrMaps) {
		this.readAttrMaps(stream, body.attrMaps);
	}
};

CTM.ReaderMG2.prototype.readVertices = function(stream, vertices) {
	stream.readInt32(); //magic "VERT"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(vertices, 3);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

	var gridIndices = this.readGridIndices(stream, vertices);

	CTM.restoreVertices(vertices, this.MG2Header, gridIndices, this.MG2Header.vertexPrecision);
};

CTM.ReaderMG2.prototype.readGridIndices = function(stream, vertices) {
	stream.readInt32(); //magic "GIDX"
	stream.readInt32(); //packed size

	var gridIndices = new Uint32Array(vertices.length / 3);

	var interleaved = new CTM.InterleavedStream(gridIndices, 1);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

	CTM.restoreGridIndices(gridIndices, gridIndices.length);

	return gridIndices;
};

CTM.ReaderMG2.prototype.readIndices = function(stream, indices) {
	stream.readInt32(); //magic "INDX"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(indices, 3);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

	CTM.restoreIndices(indices, indices.length);
};

CTM.ReaderMG2.prototype.readNormals = function(stream, body) {
	stream.readInt32(); //magic "NORM"
	stream.readInt32(); //packed size

	var interleaved = new CTM.InterleavedStream(body.normals, 3);
	LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

	var smooth = CTM.calcSmoothNormals(body.indices, body.vertices);

	CTM.restoreNormals(body.normals, smooth, this.MG2Header.normalPrecision);
};

CTM.ReaderMG2.prototype.readUVMaps = function(stream, uvMaps) {
	var i = 0;
	for (; i < uvMaps.length; ++ i) {
		stream.readInt32(); //magic "TEXC"

		uvMaps[i].name = stream.readString();
		uvMaps[i].filename = stream.readString();

		var precision = stream.readFloat32();

		stream.readInt32(); //packed size

		var interleaved = new CTM.InterleavedStream(uvMaps[i].uv, 2);
		LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

		CTM.restoreMap(uvMaps[i].uv, 2, precision);
	}
};

CTM.ReaderMG2.prototype.readAttrMaps = function(stream, attrMaps) {
	var i = 0;
	for (; i < attrMaps.length; ++ i) {
		stream.readInt32(); //magic "ATTR"

		attrMaps[i].name = stream.readString();

		var precision = stream.readFloat32();

		stream.readInt32(); //packed size

		var interleaved = new CTM.InterleavedStream(attrMaps[i].attr, 4);
		LZMA.decompress(stream, stream, interleaved, interleaved.data.length);

		CTM.restoreMap(attrMaps[i].attr, 4, precision);
	}
};

CTM.restoreIndices = function(indices, len) {
	var i = 3;
	if (len > 0) {
		indices[2] += indices[0];
		indices[1] += indices[0];
	}
	for (; i < len; i += 3) {
		indices[i] += indices[i - 3];

		if (indices[i] === indices[i - 3]) {
			indices[i + 1] += indices[i - 2];
		}else {
			indices[i + 1] += indices[i];
		}

		indices[i + 2] += indices[i];
	}
};

CTM.restoreGridIndices = function(gridIndices, len) {
	var i = 1;
	for (; i < len; ++ i) {
		gridIndices[i] += gridIndices[i - 1];
	}
};

CTM.restoreVertices = function(vertices, grid, gridIndices, precision) {
	var gridIdx, delta, x, y, z,
      intVertices = new Uint32Array(vertices.buffer, vertices.byteOffset, vertices.length),
      ydiv = grid.divx, zdiv = ydiv * grid.divy,
      prevGridIdx = 0x7fffffff, prevDelta = 0,
      i = 0, j = 0, len = gridIndices.length;

	for (; i < len; j += 3) {
		x = gridIdx = gridIndices[i ++];

		z = ~~(x / zdiv);
		x -= ~~(z * zdiv);
		y = ~~(x / ydiv);
		x -= ~~(y * ydiv);

		delta = intVertices[j];
		if (gridIdx === prevGridIdx) {
			delta += prevDelta;
		}

		vertices[j]     = grid.lowerBoundx +
      x * grid.sizex + precision * delta;
		vertices[j + 1] = grid.lowerBoundy +
      y * grid.sizey + precision * intVertices[j + 1];
		vertices[j + 2] = grid.lowerBoundz +
      z * grid.sizez + precision * intVertices[j + 2];

		prevGridIdx = gridIdx;
		prevDelta = delta;
	}
};

CTM.restoreNormals = function(normals, smooth, precision) {
	var ro, phi, theta, sinPhi,
      nx, ny, nz, by, bz, len,
      intNormals = new Uint32Array(normals.buffer, normals.byteOffset, normals.length),
      i = 0, k = normals.length,
      PI_DIV_2 = 3.141592653589793238462643 * 0.5;

	for (; i < k; i += 3) {
		ro = intNormals[i] * precision;
		phi = intNormals[i + 1];

		if (phi === 0) {
			normals[i]     = smooth[i]     * ro;
			normals[i + 1] = smooth[i + 1] * ro;
			normals[i + 2] = smooth[i + 2] * ro;
		}else {

			if (phi <= 4) {
				theta = (intNormals[i + 2] - 2) * PI_DIV_2;
			}else {
				theta = ( (intNormals[i + 2] * 4 / phi) - 2) * PI_DIV_2;
			}

			phi *= precision * PI_DIV_2;
			sinPhi = ro * Math.sin(phi);

			nx = sinPhi * Math.cos(theta);
			ny = sinPhi * Math.sin(theta);
			nz = ro * Math.cos(phi);

			bz = smooth[i + 1];
			by = smooth[i] - smooth[i + 2];

			len = Math.sqrt(2 * bz * bz + by * by);
			if (len > 1e-20) {
				by /= len;
				bz /= len;
			}

			normals[i]     = smooth[i]     * nz +
        (smooth[i + 1] * bz - smooth[i + 2] * by) * ny - bz * nx;
			normals[i + 1] = smooth[i + 1] * nz -
        (smooth[i + 2]      + smooth[i]   ) * bz  * ny + by * nx;
			normals[i + 2] = smooth[i + 2] * nz +
        (smooth[i]     * by + smooth[i + 1] * bz) * ny + bz * nx;
		}
	}
};

CTM.restoreMap = function(map, count, precision) {
	var delta, value,
      intMap = new Uint32Array(map.buffer, map.byteOffset, map.length),
      i = 0, j, len = map.length;

	for (; i < count; ++ i) {
		delta = 0;

		for (j = i; j < len; j += count) {
			value = intMap[j];

			delta += value & 1 ? -( (value + 1) >> 1) : value >> 1;

			map[j] = delta * precision;
		}
	}
};

CTM.calcSmoothNormals = function(indices, vertices) {
	var smooth = new Float32Array(vertices.length),
      indx, indy, indz, nx, ny, nz,
      v1x, v1y, v1z, v2x, v2y, v2z, len,
      i, k;

	for (i = 0, k = indices.length; i < k;) {
		indx = indices[i ++] * 3;
		indy = indices[i ++] * 3;
		indz = indices[i ++] * 3;

		v1x = vertices[indy]     - vertices[indx];
		v2x = vertices[indz]     - vertices[indx];
		v1y = vertices[indy + 1] - vertices[indx + 1];
		v2y = vertices[indz + 1] - vertices[indx + 1];
		v1z = vertices[indy + 2] - vertices[indx + 2];
		v2z = vertices[indz + 2] - vertices[indx + 2];

		nx = v1y * v2z - v1z * v2y;
		ny = v1z * v2x - v1x * v2z;
		nz = v1x * v2y - v1y * v2x;

		len = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (len > 1e-10) {
			nx /= len;
			ny /= len;
			nz /= len;
		}

		smooth[indx]     += nx;
		smooth[indx + 1] += ny;
		smooth[indx + 2] += nz;
		smooth[indy]     += nx;
		smooth[indy + 1] += ny;
		smooth[indy + 2] += nz;
		smooth[indz]     += nx;
		smooth[indz + 1] += ny;
		smooth[indz + 2] += nz;
	}

	for (i = 0, k = smooth.length; i < k; i += 3) {
		len = Math.sqrt(smooth[i] * smooth[i] +
      smooth[i + 1] * smooth[i + 1] +
      smooth[i + 2] * smooth[i + 2]);

		if (len > 1e-10) {
			smooth[i]     /= len;
			smooth[i + 1] /= len;
			smooth[i + 2] /= len;
		}
	}

	return smooth;
};

CTM.isLittleEndian = (function() {
	var buffer = new ArrayBuffer(2),
      bytes = new Uint8Array(buffer),
      ints = new Uint16Array(buffer);

	bytes[0] = 1;

	return ints[0] === 1;
}());

CTM.InterleavedStream = function(data, count) {
	this.data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	this.offset = CTM.isLittleEndian ? 3 : 0;
	this.count = count * 4;
	this.len = this.data.length;
};

CTM.InterleavedStream.prototype.writeByte = function(value) {
	this.data[this.offset] = value;

	this.offset += this.count;
	if (this.offset >= this.len) {

		this.offset -= this.len - 4;
		if (this.offset >= this.count) {

			this.offset -= this.count + (CTM.isLittleEndian ? 1 : -1);
		}
	}
};

CTM.Stream = function(data) {
	this.data = data;
	this.offset = 0;
};

CTM.Stream.prototype.TWO_POW_MINUS23 = Math.pow(2, -23);

CTM.Stream.prototype.TWO_POW_MINUS126 = Math.pow(2, -126);

CTM.Stream.prototype.readByte = function() {
	return this.data[this.offset ++] & 0xff;
};

CTM.Stream.prototype.readInt32 = function() {
	var i = this.readByte();
	i |= this.readByte() << 8;
	i |= this.readByte() << 16;
	return i | (this.readByte() << 24);
};

CTM.Stream.prototype.readFloat32 = function() {
	var m = this.readByte();
	m += this.readByte() << 8;

	var b1 = this.readByte();
	var b2 = this.readByte();

	m += (b1 & 0x7f) << 16;
	var e = ( (b2 & 0x7f) << 1) | ( (b1 & 0x80) >>> 7);
	var s = b2 & 0x80 ? -1 : 1;

	if (e === 255) {
		return m !== 0 ? NaN : s * Infinity;
	}
	if (e > 0) {
		return s * (1 + (m * this.TWO_POW_MINUS23) ) * Math.pow(2, e - 127);
	}
	if (m !== 0) {
		return s * m * this.TWO_POW_MINUS126;
	}
	return s * 0;
};

CTM.Stream.prototype.readString = function() {
	var len = this.readInt32();

	this.offset += len;

	return String.fromCharCode.apply(null, this.data.subarray(this.offset - len, this.offset));
};

CTM.Stream.prototype.readArrayInt32 = function(array) {
	var i = 0, len = array.length;

	while (i < len) {
		array[i ++] = this.readInt32();
	}

	return array;
};

CTM.Stream.prototype.readArrayFloat32 = function(array) {
	var i = 0, len = array.length;

	while (i < len) {
		array[i ++] = this.readFloat32();
	}

	return array;
};

if (typeof globalThis !== "undefined") globalThis.CTM = CTM;



/* ===================== lib/fflate.umd.js ===================== */
!function(f){typeof module!='undefined'&&typeof exports=='object'?module.exports=f():typeof define!='undefined'&&define.amd?define(f):(typeof self!='undefined'?self:this).fflate=f()}(function(){var _e={};"use strict";_e.deflate=zt,_e.deflateSync=kt,_e.inflate=At,_e.inflateSync=Tt,_e.gzip=It,_e.compress=It,_e.gzipSync=Ut,_e.compressSync=Ut,_e.gunzip=Zt,_e.gunzipSync=qt,_e.zlib=Lt,_e.zlibSync=Bt,_e.unzlib=Nt,_e.unzlibSync=Pt,_e.gzip=It,_e.compress=It,_e.decompress=Jt,_e.decompressSync=Kt,_e.strToU8=nn,_e.strFromU8=rn,_e.zip=dn,_e.zipSync=gn,_e.unzip=zn,_e.unzipSync=kn;var t=(typeof module!='undefined'&&typeof exports=='object'?function(_f){"use strict";var e,r,t,n=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{e=require("worker_threads"),r=e.Worker,t=e.isMarkedAsUntransferable}catch(e){}exports.default=r?function(e,o,a,s,u){var i=!1,l=new r(e+n,{eval:!0}).on("error",function(e){return u(e,null)}).on("message",function(e){return u(null,e)}).on("exit",function(e){e&&!i&&u(Error("exited with code "+e),null)});return t&&(s=s.filter(function(e){return!t(e)})),l.postMessage(a,s),l.terminate=function(){return i=!0,r.prototype.terminate.call(l)},l}:function(e,r,t,n,o){setImmediate(function(){return o(Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)});var a=function(){};return{terminate:a,postMessage:a}};return _f}:function(_f){"use strict";var e={};_f.default=function(r,t,s,a,n){var o=new Worker(e[t]||(e[t]=URL.createObjectURL(new Blob([r+';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'],{type:"text/javascript"}))));return o.onmessage=function(e){var r=e.data,t=r.$e$;if(t){var s=Error(t[0]);s.code=t[1],s.stack=t[2],n(s,null)}else n(null,r)},o.postMessage(s,a),o};return _f})({}),n=Uint8Array,r=Uint16Array,i=Int32Array,e=new n([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),o=new n([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),s=new n([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),a=function(t,n){for(var e=new r(31),o=0;o<31;++o)e[o]=n+=1<<t[o-1];var s=new i(e[30]);for(o=1;o<30;++o)for(var a=e[o];a<e[o+1];++a)s[a]=a-e[o]<<5|o;return{b:e,r:s}},u=a(e,2),h=u.b,f=u.r;h[28]=258,f[258]=28;for(var c=a(o,0),l=c.b,p=c.r,v=new r(32768),d=0;d<32768;++d){var g=(43690&d)>>1|(21845&d)<<1;v[d]=((65280&(g=(61680&(g=(52428&g)>>2|(13107&g)<<2))>>4|(3855&g)<<4))>>8|(255&g)<<8)>>1}var y=function(t,n,i){for(var e=t.length,o=0,s=new r(n);o<e;++o)t[o]&&++s[t[o]-1];var a,u=new r(n);for(o=1;o<n;++o)u[o]=u[o-1]+s[o-1]<<1;if(i){a=new r(1<<n);var h=15-n;for(o=0;o<e;++o)if(t[o])for(var f=o<<4|t[o],c=n-t[o],l=u[t[o]-1]++<<c,p=l|(1<<c)-1;l<=p;++l)a[v[l]>>h]=f}else for(a=new r(e),o=0;o<e;++o)t[o]&&(a[o]=v[u[t[o]-1]++]>>15-t[o]);return a},m=new n(288);for(d=0;d<144;++d)m[d]=8;for(d=144;d<256;++d)m[d]=9;for(d=256;d<280;++d)m[d]=7;for(d=280;d<288;++d)m[d]=8;var b=new n(32);for(d=0;d<32;++d)b[d]=5;var w=y(m,9,0),x=y(m,9,1),z=y(b,5,0),k=y(b,5,1),M=function(t){for(var n=t[0],r=1;r<t.length;++r)t[r]>n&&(n=t[r]);return n},S=function(t,n,r){var i=n/8|0;return(t[i]|t[i+1]<<8)>>(7&n)&r},A=function(t,n){var r=n/8|0;return(t[r]|t[r+1]<<8|t[r+2]<<16)>>(7&n)},T=function(t){return(t+7)/8|0},D=function(t,r,i){return(null==r||r<0)&&(r=0),(null==i||i>t.length)&&(i=t.length),new n(t.subarray(r,i))};_e.FlateErrorCode={UnexpectedEOF:0,InvalidBlockType:1,InvalidLengthLiteral:2,InvalidDistance:3,StreamFinished:4,NoStreamHandler:5,InvalidHeader:6,NoCallback:7,InvalidUTF8:8,ExtraFieldTooLong:9,InvalidDate:10,FilenameTooLong:11,StreamFinishing:12,InvalidZipData:13,UnknownCompressionMethod:14};var C=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],I=function(t,n,r){var i=Error(n||C[t]);if(i.code=t,Error.captureStackTrace&&Error.captureStackTrace(i,I),!r)throw i;return i},U=function(t,r,i,a){var u=t.length,f=a?a.length:0;if(!u||r.f&&!r.l)return i||new n(0);var c=!i,p=c||2!=r.i,v=r.i;c&&(i=new n(3*u));var d=function(t){var r=i.length;if(t>r){var e=new n(Math.max(2*r,t));e.set(i),i=e}},g=r.f||0,m=r.p||0,b=r.b||0,w=r.l,z=r.d,C=r.m,U=r.n,F=8*u;do{if(!w){g=S(t,m,1);var E=S(t,m+1,3);if(m+=3,!E){var Z=t[(Y=T(m)+4)-4]|t[Y-3]<<8,q=Y+Z;if(q>u){v&&I(0);break}p&&d(b+Z),i.set(t.subarray(Y,q),b),r.b=b+=Z,r.p=m=8*q,r.f=g;continue}if(1==E)w=x,z=k,C=9,U=5;else if(2==E){var O=S(t,m,31)+257,G=S(t,m+10,15)+4,L=O+S(t,m+5,31)+1;m+=14;for(var B=new n(L),H=new n(19),j=0;j<G;++j)H[s[j]]=S(t,m+3*j,7);m+=3*G;var N=M(H),P=(1<<N)-1,V=y(H,N,1);for(j=0;j<L;){var Y,J=V[S(t,m,P)];if(m+=15&J,(Y=J>>4)<16)B[j++]=Y;else{var K=0,Q=0;for(16==Y?(Q=3+S(t,m,3),m+=2,K=B[j-1]):17==Y?(Q=3+S(t,m,7),m+=3):18==Y&&(Q=11+S(t,m,127),m+=7);Q--;)B[j++]=K}}var R=B.subarray(0,O),W=B.subarray(O);C=M(R),U=M(W),w=y(R,C,1),z=y(W,U,1)}else I(1);if(m>F){v&&I(0);break}}p&&d(b+131072);for(var X=(1<<C)-1,$=(1<<U)-1,_=m;;_=m){var tt=(K=w[A(t,m)&X])>>4;if((m+=15&K)>F){v&&I(0);break}if(K||I(2),tt<256)i[b++]=tt;else{if(256==tt){_=m,w=null;break}var nt=tt-254;tt>264&&(nt=S(t,m,(1<<(et=e[j=tt-257]))-1)+h[j],m+=et);var rt=z[A(t,m)&$],it=rt>>4;if(rt||I(3),m+=15&rt,W=l[it],it>3){var et=o[it];W+=A(t,m)&(1<<et)-1,m+=et}if(m>F){v&&I(0);break}p&&d(b+131072);var ot=b+nt;if(b<W){var st=f-W,at=Math.min(W,ot);for(st+b<0&&I(3);b<at;++b)i[b]=a[st+b]}for(;b<ot;++b)i[b]=i[b-W]}}r.l=w,r.p=_,r.b=b,r.f=g,w&&(g=1,r.m=C,r.d=z,r.n=U)}while(!g);return b!=i.length&&c?D(i,0,b):i.subarray(0,b)},F=function(t,n,r){var i=n/8|0;t[i]|=r<<=7&n,t[i+1]|=r>>8},E=function(t,n,r){var i=n/8|0;t[i]|=r<<=7&n,t[i+1]|=r>>8,t[i+2]|=r>>16},Z=function(t,i){for(var e=[],o=0;o<t.length;++o)t[o]&&e.push({s:o,f:t[o]});var s=e.length,a=e.slice();if(!s)return{t:j,l:0};if(1==s){var u=new n(e[0].s+1);return u[e[0].s]=1,{t:u,l:1}}e.sort(function(t,n){return t.f-n.f}),e.push({s:-1,f:25001});var h=e[0],f=e[1],c=0,l=1,p=2;for(e[0]={s:-1,f:h.f+f.f,l:h,r:f};l!=s-1;)h=e[e[c].f<e[p].f?c++:p++],f=e[c!=l&&e[c].f<e[p].f?c++:p++],e[l++]={s:-1,f:h.f+f.f,l:h,r:f};var v=a[0].s;for(o=1;o<s;++o)a[o].s>v&&(v=a[o].s);var d=new r(v+1),g=q(e[l-1],d,0);if(g>i){o=0;var y=0,m=g-i,b=1<<m;for(a.sort(function(t,n){return d[n.s]-d[t.s]||t.f-n.f});o<s;++o){var w=a[o].s;if(!(d[w]>i))break;y+=b-(1<<g-d[w]),d[w]=i}for(y>>=m;y>0;){var x=a[o].s;d[x]<i?y-=1<<i-d[x]++-1:++o}for(;o>=0&&y;--o){var z=a[o].s;d[z]==i&&(--d[z],++y)}g=i}return{t:new n(d),l:g}},q=function(t,n,r){return-1==t.s?Math.max(q(t.l,n,r+1),q(t.r,n,r+1)):n[t.s]=r},O=function(t){for(var n=t.length;n&&!t[--n];);for(var i=new r(++n),e=0,o=t[0],s=1,a=function(t){i[e++]=t},u=1;u<=n;++u)if(t[u]==o&&u!=n)++s;else{if(!o&&s>2){for(;s>138;s-=138)a(32754);s>2&&(a(s>10?s-11<<5|28690:s-3<<5|12305),s=0)}else if(s>3){for(a(o),--s;s>6;s-=6)a(8304);s>2&&(a(s-3<<5|8208),s=0)}for(;s--;)a(o);s=1,o=t[u]}return{c:i.subarray(0,e),n:n}},G=function(t,n){for(var r=0,i=0;i<n.length;++i)r+=t[i]*n[i];return r},L=function(t,n,r){var i=r.length,e=T(n+2);t[e]=255&i,t[e+1]=i>>8,t[e+2]=255^t[e],t[e+3]=255^t[e+1];for(var o=0;o<i;++o)t[e+o+4]=r[o];return 8*(e+4+i)},B=function(t,n,i,a,u,h,f,c,l,p,v){F(n,v++,i),++u[256];for(var d=Z(u,15),g=d.t,x=d.l,k=Z(h,15),M=k.t,S=k.l,A=O(g),T=A.c,D=A.n,C=O(M),I=C.c,U=C.n,q=new r(19),B=0;B<T.length;++B)++q[31&T[B]];for(B=0;B<I.length;++B)++q[31&I[B]];for(var H=Z(q,7),j=H.t,N=H.l,P=19;P>4&&!j[s[P-1]];--P);var V,Y,J,K,Q=p+5<<3,R=G(u,m)+G(h,b)+f,W=G(u,g)+G(h,M)+f+14+3*P+G(q,j)+2*q[16]+3*q[17]+7*q[18];if(l>=0&&Q<=R&&Q<=W)return L(n,v,t.subarray(l,l+p));if(F(n,v,1+(W<R)),v+=2,W<R){V=y(g,x,0),Y=g,J=y(M,S,0),K=M;var X=y(j,N,0);for(F(n,v,D-257),F(n,v+5,U-1),F(n,v+10,P-4),v+=14,B=0;B<P;++B)F(n,v+3*B,j[s[B]]);v+=3*P;for(var $=[T,I],_=0;_<2;++_){var tt=$[_];for(B=0;B<tt.length;++B)F(n,v,X[rt=31&tt[B]]),v+=j[rt],rt>15&&(F(n,v,tt[B]>>5&127),v+=tt[B]>>12)}}else V=w,Y=m,J=z,K=b;for(B=0;B<c;++B){var nt=a[B];if(nt>255){var rt;E(n,v,V[257+(rt=nt>>18&31)]),v+=Y[rt+257],rt>7&&(F(n,v,nt>>23&31),v+=e[rt]);var it=31&nt;E(n,v,J[it]),v+=K[it],it>3&&(E(n,v,nt>>5&8191),v+=o[it])}else E(n,v,V[nt]),v+=Y[nt]}return E(n,v,V[256]),v+Y[256]},H=new i([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),j=new n(0),N=function(t,s,a,u,h,c){var l=c.z||t.length,v=new n(u+l+5*(1+Math.ceil(l/7e3))+h),d=v.subarray(u,v.length-h),g=c.l,y=7&(c.r||0);if(s){y&&(d[0]=c.r>>3);for(var m=H[s-1],b=m>>13,w=8191&m,x=(1<<a)-1,z=c.p||new r(32768),k=c.h||new r(x+1),M=Math.ceil(a/3),S=2*M,A=function(n){return(t[n]^t[n+1]<<M^t[n+2]<<S)&x},C=new i(25e3),I=new r(288),U=new r(32),F=0,E=0,Z=c.i||0,q=0,O=c.w||0,G=0;Z+2<l;++Z){var j=A(Z),N=32767&Z,P=k[j];if(z[N]=P,k[j]=N,O<=Z){var V=l-Z;if((F>7e3||q>24576)&&(V>423||!g)){y=B(t,d,0,C,I,U,E,q,G,Z-G,y),q=F=E=0,G=Z;for(var Y=0;Y<286;++Y)I[Y]=0;for(Y=0;Y<30;++Y)U[Y]=0}var J=2,K=0,Q=w,R=N-P&32767;if(V>2&&j==A(Z-R))for(var W=Math.min(b,V)-1,X=Math.min(32767,Z),$=Math.min(258,V);R<=X&&--Q&&N!=P;){if(t[Z+J]==t[Z+J-R]){for(var _=0;_<$&&t[Z+_]==t[Z+_-R];++_);if(_>J){if(J=_,K=R,_>W)break;var tt=Math.min(R,_-2),nt=0;for(Y=0;Y<tt;++Y){var rt=Z-R+Y&32767,it=rt-z[rt]&32767;it>nt&&(nt=it,P=rt)}}}R+=(N=P)-(P=z[N])&32767}if(K){C[q++]=268435456|f[J]<<18|p[K];var et=31&f[J],ot=31&p[K];E+=e[et]+o[ot],++I[257+et],++U[ot],O=Z+J,++F}else C[q++]=t[Z],++I[t[Z]]}}for(Z=Math.max(Z,O);Z<l;++Z)C[q++]=t[Z],++I[t[Z]];y=B(t,d,g,C,I,U,E,q,G,Z-G,y),g||(c.r=7&y|d[y/8|0]<<3,y-=7,c.h=k,c.p=z,c.i=Z,c.w=O)}else{for(Z=c.w||0;Z<l+g;Z+=65535){var st=Z+65535;st>=l&&(d[y/8|0]=g,st=l),y=L(d,y+1,t.subarray(Z,st))}c.i=l}return D(v,0,u+T(y)+h)},P=function(){for(var t=new Int32Array(256),n=0;n<256;++n){for(var r=n,i=9;--i;)r=(1&r&&-306674912)^r>>>1;t[n]=r}return t}(),V=function(){var t=-1;return{p:function(n){for(var r=t,i=0;i<n.length;++i)r=P[255&r^n[i]]^r>>>8;t=r},d:function(){return~t}}},Y=function(){var t=1,n=0;return{p:function(r){for(var i=t,e=n,o=0|r.length,s=0;s!=o;){for(var a=Math.min(s+2655,o);s<a;++s)e+=i+=r[s];i=(65535&i)+15*(i>>16),e=(65535&e)+15*(e>>16)}t=i,n=e},d:function(){return(255&(t%=65521))<<24|(65280&t)<<8|(255&(n%=65521))<<8|n>>8}}},J=function(t,r,i,e,o){if(!o&&(o={l:1},r.dictionary)){var s=r.dictionary.subarray(-32768),a=new n(s.length+t.length);a.set(s),a.set(t,s.length),t=a,o.w=s.length}return N(t,null==r.level?6:r.level,null==r.mem?o.l?Math.ceil(1.5*Math.max(8,Math.min(13,Math.log(t.length)))):20:12+r.mem,i,e,o)},K=function(t,n){var r={};for(var i in t)r[i]=t[i];for(var i in n)r[i]=n[i];return r},Q=function(t,n,r){for(var i=t(),e=""+t,o=e.slice(e.indexOf("[")+1,e.lastIndexOf("]")).replace(/\s+/g,"").split(","),s=0;s<i.length;++s){var a=i[s],u=o[s];if("function"==typeof a){n+=";"+u+"=";var h=""+a;if(a.prototype)if(-1!=h.indexOf("[native code]")){var f=h.indexOf(" ",8)+1;n+=h.slice(f,h.indexOf("(",f))}else for(var c in n+=h,a.prototype)n+=";"+u+".prototype."+c+"="+a.prototype[c];else n+=h}else r[u]=a}return n},R=[],W=function(t){var n=[];for(var r in t)t[r].buffer&&n.push((t[r]=new t[r].constructor(t[r])).buffer);return n},X=function(n,r,i,e){if(!R[i]){for(var o="",s={},a=n.length-1,u=0;u<a;++u)o=Q(n[u],o,s);R[i]={c:Q(n[a],o,s),e:s}}var h=K({},R[i].e);return(0,t.default)(R[i].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+r+"}",i,h,W(h),e)},$=function(){return[n,r,i,e,o,s,h,l,x,k,v,C,y,M,S,A,T,D,I,U,Tt,et,ot]},_=function(){return[n,r,i,e,o,s,f,p,w,m,z,b,v,H,j,y,F,E,Z,q,O,G,L,B,T,D,N,J,kt,et]},tt=function(){return[pt,gt,lt,V,P]},nt=function(){return[vt,dt]},rt=function(){return[yt,lt,Y]},it=function(){return[mt]},et=function(t){return postMessage(t,[t.buffer])},ot=function(t){return t&&{out:t.size&&new n(t.size),dictionary:t.dictionary}},st=function(t,n,r,i,e,o){var s=X(r,i,e,function(t,n){s.terminate(),o(t,n)});return s.postMessage([t,n],n.consume?[t.buffer]:[]),function(){s.terminate()}},at=function(t){return t.ondata=function(t,n){return postMessage([t,n],[t.buffer])},function(n){n.data[0]?(t.push(n.data[0],n.data[1]),postMessage([n.data[0].length])):t.flush(n.data[1])}},ut=function(t,n,r,i,e,o,s){var a,u=X(t,i,e,function(t,r){t?(u.terminate(),n.ondata.call(n,t)):Array.isArray(r)?1==r.length?(n.queuedSize-=r[0],n.ondrain&&n.ondrain(r[0])):(r[1]&&u.terminate(),n.ondata.call(n,t,r[0],r[1])):s(r)});u.postMessage(r),n.queuedSize=0,n.push=function(t,r){n.ondata||I(5),a&&n.ondata(I(4,0,1),null,!!r),n.queuedSize+=t.length,u.postMessage([t,a=r],t.buffer instanceof ArrayBuffer?[t.buffer]:[])},n.terminate=function(){u.terminate()},o&&(n.flush=function(t){u.postMessage([0,t])})},ht=function(t,n){return t[n]|t[n+1]<<8},ft=function(t,n){return(t[n]|t[n+1]<<8|t[n+2]<<16|t[n+3]<<24)>>>0},ct=function(t,n){return ft(t,n)+4294967296*ft(t,n+4)},lt=function(t,n,r){for(;r;++n)t[n]=r,r>>>=8},pt=function(t,n){var r=n.filename;if(t[0]=31,t[1]=139,t[2]=8,t[8]=n.level<2?4:9==n.level?2:0,t[9]=3,0!=n.mtime&&lt(t,4,Math.floor(new Date(n.mtime||Date.now())/1e3)),r){t[3]=8;for(var i=0;i<=r.length;++i)t[i+10]=r.charCodeAt(i)}},vt=function(t){31==t[0]&&139==t[1]&&8==t[2]||I(6,"invalid gzip data");var n=t[3],r=10;4&n&&(r+=2+(t[10]|t[11]<<8));for(var i=(n>>3&1)+(n>>4&1);i>0;i-=!t[r++]);return r+(2&n)},dt=function(t){var n=t.length;return(t[n-4]|t[n-3]<<8|t[n-2]<<16|t[n-1]<<24)>>>0},gt=function(t){return 10+(t.filename?t.filename.length+1:0)},yt=function(t,n){var r=n.level,i=0==r?0:r<6?1:9==r?3:2;if(t[0]=120,t[1]=i<<6|(n.dictionary&&32),t[1]|=31-(t[0]<<8|t[1])%31,n.dictionary){var e=Y();e.p(n.dictionary),lt(t,2,e.d())}},mt=function(t,n){return(8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31)&&I(6,"invalid zlib data"),(t[1]>>5&1)==+!n&&I(6,"invalid zlib data: "+(32&t[1]?"need":"unexpected")+" dictionary"),2+(t[1]>>3&4)};function bt(t,n){return"function"==typeof t&&(n=t,t={}),this.ondata=n,t}var wt=function(){function t(t,r){if("function"==typeof t&&(r=t,t={}),this.ondata=r,this.o=t||{},this.s={l:0,i:32768,w:32768,z:32768},this.b=new n(98304),this.o.dictionary){var i=this.o.dictionary.subarray(-32768);this.b.set(i,32768-i.length),this.s.i=32768-i.length}}return t.prototype.p=function(t,n){this.ondata(J(t,this.o,0,0,this.s),n)},t.prototype.push=function(t,r){this.ondata||I(5),this.s.l&&I(4);var i=t.length+this.s.z;if(i>this.b.length){if(i>2*this.b.length-32768){var e=new n(-32768&i);e.set(this.b.subarray(0,this.s.z)),this.b=e}var o=this.b.length-this.s.z;this.b.set(t.subarray(0,o),this.s.z),this.s.z=this.b.length,this.p(this.b,!1),this.b.set(this.b.subarray(-32768)),this.b.set(t.subarray(o),32768),this.s.z=t.length-o+32768,this.s.i=32766,this.s.w=32768}else this.b.set(t,this.s.z),this.s.z+=t.length;this.s.l=1&r,(this.s.z>this.s.w+8191||r)&&(this.p(this.b,r||!1),this.s.w=this.s.i,this.s.i-=2),r&&(this.s=this.o={},this.b=j)},t.prototype.flush=function(t){if(this.ondata||I(5),this.s.l&&I(4),this.p(this.b,!1),this.s.w=this.s.i,this.s.i-=2,t){var r=new n(6);r[0]=this.s.r>>3;var i=L(r,this.s.r,j);this.s.r=0,this.ondata(r.subarray(0,i>>3),!1)}},t}();_e.Deflate=wt;var xt=function(){return function(t,n){ut([_,function(){return[at,wt]}],this,bt.call(this,t,n),function(t){var n=new wt(t.data);onmessage=at(n)},6,1)}}();function zt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_],function(t){return et(kt(t.data[0],t.data[1]))},0,r)}function kt(t,n){return J(t,n||{},0,0)}_e.AsyncDeflate=xt;var Mt=function(){function t(t,r){"function"==typeof t&&(r=t,t={}),this.ondata=r;var i=t&&t.dictionary&&t.dictionary.subarray(-32768);this.s={i:0,b:i?i.length:0},this.o=new n(32768),this.p=new n(0),i&&this.o.set(i)}return t.prototype.e=function(t){if(this.ondata||I(5),this.d&&I(4),this.p.length){if(t.length){var r=new n(this.p.length+t.length);r.set(this.p),r.set(t,this.p.length),this.p=r}}else this.p=t},t.prototype.c=function(t){this.s.i=+(this.d=t||!1);var n=this.s.b,r=U(this.p,this.s,this.o);this.ondata(D(r,n,this.s.b),this.d),this.o=D(r,this.s.b-32768),this.s.b=this.o.length,this.p=D(this.p,this.s.p/8|0),this.s.p&=7},t.prototype.push=function(t,n){this.e(t),this.c(n)},t}();_e.Inflate=Mt;var St=function(){return function(t,n){ut([$,function(){return[at,Mt]}],this,bt.call(this,t,n),function(t){var n=new Mt(t.data);onmessage=at(n)},7,0)}}();function At(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$],function(t){return et(Tt(t.data[0],ot(t.data[1])))},1,r)}function Tt(t,n){return U(t,{i:2},n&&n.out,n&&n.dictionary)}_e.AsyncInflate=St;var Dt=function(){function t(t,n){this.c=V(),this.l=0,this.v=1,wt.call(this,t,n)}return t.prototype.push=function(t,n){this.c.p(t),this.l+=t.length,wt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){var r=J(t,this.o,this.v&&gt(this.o),n&&8,this.s);this.v&&(pt(r,this.o),this.v=0),n&&(lt(r,r.length-8,this.c.d()),lt(r,r.length-4,this.l)),this.ondata(r,n)},t.prototype.flush=function(t){wt.prototype.flush.call(this,t)},t}();_e.Gzip=Dt,_e.Compress=Dt;var Ct=function(){return function(t,n){ut([_,tt,function(){return[at,wt,Dt]}],this,bt.call(this,t,n),function(t){var n=new Dt(t.data);onmessage=at(n)},8,1)}}();function It(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_,tt,function(){return[Ut]}],function(t){return et(Ut(t.data[0],t.data[1]))},2,r)}function Ut(t,n){n||(n={});var r=V(),i=t.length;r.p(t);var e=J(t,n,gt(n),8),o=e.length;return pt(e,n),lt(e,o-8,r.d()),lt(e,o-4,i),e}_e.AsyncGzip=Ct,_e.AsyncCompress=Ct;var Ft=function(){function t(t,n){this.v=1,this.r=0,Mt.call(this,t,n)}return t.prototype.push=function(t,r){if(Mt.prototype.e.call(this,t),this.r+=t.length,this.v){var i=this.p.subarray(this.v-1),e=i.length>3?vt(i):4;if(e>i.length){if(!r)return}else this.v>1&&this.onmember&&this.onmember(this.r-i.length);this.p=i.subarray(e),this.v=0}Mt.prototype.c.call(this,0),this.s.f&&!this.s.l?(this.v=T(this.s.p)+9,this.s={i:0},this.o=new n(0),this.push(new n(0),r)):r&&Mt.prototype.c.call(this,r)},t}();_e.Gunzip=Ft;var Et=function(){return function(t,n){var r=this;ut([$,nt,function(){return[at,Mt,Ft]}],this,bt.call(this,t,n),function(t){var n=new Ft(t.data);n.onmember=function(t){return postMessage(t)},onmessage=at(n)},9,0,function(t){return r.onmember&&r.onmember(t)})}}();function Zt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$,nt,function(){return[qt]}],function(t){return et(qt(t.data[0],t.data[1]))},3,r)}function qt(t,r){var i=vt(t);return i+8>t.length&&I(6,"invalid gzip data"),U(t.subarray(i,-8),{i:2},r&&r.out||new n(dt(t)),r&&r.dictionary)}_e.AsyncGunzip=Et;var Ot=function(){function t(t,n){this.c=Y(),this.v=1,wt.call(this,t,n)}return t.prototype.push=function(t,n){this.c.p(t),wt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){var r=J(t,this.o,this.v&&(this.o.dictionary?6:2),n&&4,this.s);this.v&&(yt(r,this.o),this.v=0),n&&lt(r,r.length-4,this.c.d()),this.ondata(r,n)},t.prototype.flush=function(t){wt.prototype.flush.call(this,t)},t}();_e.Zlib=Ot;var Gt=function(){return function(t,n){ut([_,rt,function(){return[at,wt,Ot]}],this,bt.call(this,t,n),function(t){var n=new Ot(t.data);onmessage=at(n)},10,1)}}();function Lt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[_,rt,function(){return[Bt]}],function(t){return et(Bt(t.data[0],t.data[1]))},4,r)}function Bt(t,n){n||(n={});var r=Y();r.p(t);var i=J(t,n,n.dictionary?6:2,4);return yt(i,n),lt(i,i.length-4,r.d()),i}_e.AsyncZlib=Gt;var Ht=function(){function t(t,n){Mt.call(this,t,n),this.v=t&&t.dictionary?2:1}return t.prototype.push=function(t,n){if(Mt.prototype.e.call(this,t),this.v){if(this.p.length<6&&!n)return;this.p=this.p.subarray(mt(this.p,this.v-1)),this.v=0}n&&(this.p.length<4&&I(6,"invalid zlib data"),this.p=this.p.subarray(0,-4)),Mt.prototype.c.call(this,n)},t}();_e.Unzlib=Ht;var jt=function(){return function(t,n){ut([$,it,function(){return[at,Mt,Ht]}],this,bt.call(this,t,n),function(t){var n=new Ht(t.data);onmessage=at(n)},11,0)}}();function Nt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),st(t,n,[$,it,function(){return[Pt]}],function(t){return et(Pt(t.data[0],ot(t.data[1])))},5,r)}function Pt(t,n){return U(t.subarray(mt(t,n&&n.dictionary),-4),{i:2},n&&n.out,n&&n.dictionary)}_e.AsyncUnzlib=jt;var Vt=function(){function t(t,n){this.o=bt.call(this,t,n)||{},this.G=Ft,this.I=Mt,this.Z=Ht}return t.prototype.i=function(){var t=this;this.s.ondata=function(n,r){t.ondata(n,r)}},t.prototype.push=function(t,r){if(this.ondata||I(5),this.s)this.s.push(t,r);else{if(this.p&&this.p.length){var i=new n(this.p.length+t.length);i.set(this.p),i.set(t,this.p.length)}else this.p=t;this.p.length>2&&(this.s=31==this.p[0]&&139==this.p[1]&&8==this.p[2]?new this.G(this.o):8!=(15&this.p[0])||this.p[0]>>4>7||(this.p[0]<<8|this.p[1])%31?new this.I(this.o):new this.Z(this.o),this.i(),this.s.push(this.p,r),this.p=null)}},t}();_e.Decompress=Vt;var Yt=function(){function t(t,n){Vt.call(this,t,n),this.queuedSize=0,this.G=Et,this.I=St,this.Z=jt}return t.prototype.i=function(){var t=this;this.s.ondata=function(n,r,i){t.ondata(n,r,i)},this.s.ondrain=function(n){t.queuedSize-=n,t.ondrain&&t.ondrain(n)}},t.prototype.push=function(t,n){this.queuedSize+=t.length,Vt.prototype.push.call(this,t,n)},t}();function Jt(t,n,r){return r||(r=n,n={}),"function"!=typeof r&&I(7),31==t[0]&&139==t[1]&&8==t[2]?Zt(t,n,r):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?At(t,n,r):Nt(t,n,r)}function Kt(t,n){return 31==t[0]&&139==t[1]&&8==t[2]?qt(t,n):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?Tt(t,n):Pt(t,n)}_e.AsyncDecompress=Yt;var Qt=function(t,r,i,e){for(var o in t){var s=t[o],a=r+o,u=e;Array.isArray(s)&&(u=K(e,s[1]),s=s[0]),ArrayBuffer.isView(s)?i[a]=[s,u]:(i[a+="/"]=[new n(0),u],Qt(s,a,i,e))}},Rt="undefined"!=typeof TextEncoder&&new TextEncoder,Wt="undefined"!=typeof TextDecoder&&new TextDecoder,Xt=0;try{Wt.decode(j,{stream:!0}),Xt=1}catch(t){}var $t=function(t){for(var n="",r=0;;){var i=t[r++],e=(i>127)+(i>223)+(i>239);if(r+e>t.length)return{s:n,r:D(t,r-1)};e?3==e?(i=((15&i)<<18|(63&t[r++])<<12|(63&t[r++])<<6|63&t[r++])-65536,n+=String.fromCharCode(55296|i>>10,56320|1023&i)):n+=String.fromCharCode(1&e?(31&i)<<6|63&t[r++]:(15&i)<<12|(63&t[r++])<<6|63&t[r++]):n+=String.fromCharCode(i)}},_t=function(){function t(t){this.ondata=t,Xt?this.t=new TextDecoder:this.p=j}return t.prototype.push=function(t,r){if(this.ondata||I(5),r=!!r,this.t)return this.ondata(this.t.decode(t,{stream:!0}),r),void(r&&(this.t.decode().length&&I(8),this.t=null));this.p||I(4);var i=new n(this.p.length+t.length);i.set(this.p),i.set(t,this.p.length);var e=$t(i),o=e.s,s=e.r;r?(s.length&&I(8),this.p=null):this.p=s,this.ondata(o,r)},t}();_e.DecodeUTF8=_t;var tn=function(){function t(t){this.ondata=t}return t.prototype.push=function(t,n){this.ondata||I(5),this.d&&I(4),this.ondata(nn(t),this.d=n||!1)},t}();function nn(t,r){if(r){for(var i=new n(t.length),e=0;e<t.length;++e)i[e]=t.charCodeAt(e);return i}if(Rt)return Rt.encode(t);var o=t.length,s=new n(t.length+(t.length>>1)),a=0,u=function(t){s[a++]=t};for(e=0;e<o;++e){if(a+5>s.length){var h=new n(a+8+(o-e<<1));h.set(s),s=h}var f=t.charCodeAt(e);f<128||r?u(f):f<2048?(u(192|f>>6),u(128|63&f)):f>55295&&f<57344?(u(240|(f=65536+(1047552&f)|1023&t.charCodeAt(++e))>>18),u(128|f>>12&63),u(128|f>>6&63),u(128|63&f)):(u(224|f>>12),u(128|f>>6&63),u(128|63&f))}return D(s,0,a)}function rn(t,n){if(n){for(var r="",i=0;i<t.length;i+=16384)r+=String.fromCharCode.apply(null,t.subarray(i,i+16384));return r}if(Wt)return Wt.decode(t);var e=$t(t),o=e.s;return(r=e.r).length&&I(8),o}_e.EncodeUTF8=tn;var en=function(t){return 1==t?3:t<6?2:9==t?1:0},on=function(t,n){return n+30+ht(t,n+26)+ht(t,n+28)},sn=function(t,n,r){var i=ht(t,n+28),e=ht(t,n+30),o=rn(t.subarray(n+46,n+46+i),!(2048&ht(t,n+8))),s=n+46+i,a=an(t,s,e,r,ft(t,n+20),ft(t,n+24),ft(t,n+42)),u=a[0],h=a[1],f=a[2];return[ht(t,n+10),u,h,o,s+e+ht(t,n+32),f]},an=function(t,n,r,i,e,o,s){var a=4294967295==e,u=4294967295==o,h=4294967295==s,f=n+r;if(i&&a+u+h){for(;n+4<f;n+=4+ht(t,n+2))if(1==ht(t,n))return[a?ct(t,n+4+8*u):e,u?ct(t,n+4):o,h?ct(t,n+4+8*(u+a)):s,1];i<2&&I(13)}return[e,o,s,0]},un=function(t){var n=0;if(t)for(var r in t){var i=t[r].length;i>65535&&I(9),n+=i+4}return n},hn=function(t,n,r,i,e,o,s,a){var u=i.length,h=r.extra,f=a&&a.length,c=un(h);lt(t,n,null!=s?33639248:67324752),n+=4,null!=s&&(t[n++]=20,t[n++]=r.os),t[n]=20,n+=2,t[n++]=r.flag<<1|(o<0&&8),t[n++]=e&&8,t[n++]=255&r.compression,t[n++]=r.compression>>8;var l=new Date(null==r.mtime?Date.now():r.mtime),p=l.getFullYear()-1980;if((p<0||p>119)&&I(10),lt(t,n,p<<25|l.getMonth()+1<<21|l.getDate()<<16|l.getHours()<<11|l.getMinutes()<<5|l.getSeconds()>>1),n+=4,-1!=o&&(lt(t,n,r.crc),lt(t,n+4,o<0?-o-2:o),lt(t,n+8,r.size)),lt(t,n+12,u),lt(t,n+14,c),n+=16,null!=s&&(lt(t,n,f),lt(t,n+6,r.attrs),lt(t,n+10,s),n+=14),t.set(i,n),n+=u,c)for(var v in h){var d=h[v],g=d.length;lt(t,n,+v),lt(t,n+2,g),t.set(d,n+4),n+=4+g}return f&&(t.set(a,n),n+=f),n},fn=function(t,n,r,i,e){lt(t,n,101010256),lt(t,n+8,r),lt(t,n+10,r),lt(t,n+12,i),lt(t,n+16,e)},cn=function(){function t(t){this.filename=t,this.c=V(),this.size=0,this.compression=0}return t.prototype.process=function(t,n){this.ondata(null,t,n)},t.prototype.push=function(t,n){this.ondata||I(5),this.c.p(t),this.size+=t.length,n&&(this.crc=this.c.d()),this.process(t,n||!1)},t}();_e.ZipPassThrough=cn;var ln=function(){function t(t,n){var r=this;n||(n={}),cn.call(this,t),this.d=new wt(n,function(t,n){r.ondata(null,t,n)}),this.compression=8,this.flag=en(n.level)}return t.prototype.process=function(t,n){try{this.d.push(t,n)}catch(t){this.ondata(t,null,n)}},t.prototype.push=function(t,n){cn.prototype.push.call(this,t,n)},t}();_e.ZipDeflate=ln;var pn=function(){function t(t,n){var r=this;n||(n={}),cn.call(this,t),this.d=new xt(n,function(t,n,i){r.ondata(t,n,i)}),this.compression=8,this.flag=en(n.level),this.terminate=this.d.terminate}return t.prototype.process=function(t,n){this.d.push(t,n)},t.prototype.push=function(t,n){cn.prototype.push.call(this,t,n)},t}();_e.AsyncZipDeflate=pn;var vn=function(){function t(t){this.ondata=t,this.u=[],this.d=1}return t.prototype.add=function(t){var r=this;if(this.ondata||I(5),2&this.d)this.ondata(I(4+8*(1&this.d),0,1),null,!1);else{var i=nn(t.filename),e=i.length,o=t.comment,s=o&&nn(o),a=e!=t.filename.length||s&&o.length!=s.length,u=e+un(t.extra)+30;e>65535&&this.ondata(I(11,0,1),null,!1);var h=new n(u);hn(h,0,t,i,a,-1);var f=[h],c=function(){for(var t=0,n=f;t<n.length;t++)r.ondata(null,n[t],!1);f=[]},l=this.d;this.d=0;var p=this.u.length,v=K(t,{f:i,u:a,o:s,t:function(){t.terminate&&t.terminate()},r:function(){if(c(),l){var t=r.u[p+1];t?t.r():r.d=1}l=1}}),d=0;t.ondata=function(i,e,o){if(i)r.ondata(i,e,o),r.terminate();else if(d+=e.length,f.push(e),o){var s=new n(16);lt(s,0,134695760),lt(s,4,t.crc),lt(s,8,d),lt(s,12,t.size),f.push(s),v.c=d,v.b=u+d+16,v.crc=t.crc,v.size=t.size,l&&v.r(),l=1}else l&&c()},this.u.push(v)}},t.prototype.end=function(){var t=this;2&this.d?this.ondata(I(4+8*(1&this.d),0,1),null,!0):(this.d?this.e():this.u.push({r:function(){1&t.d&&(t.u.splice(-1,1),t.e())},t:function(){}}),this.d=3)},t.prototype.e=function(){for(var t=0,r=0,i=0,e=0,o=this.u;e<o.length;e++)i+=46+(h=o[e]).f.length+un(h.extra)+(h.o?h.o.length:0);for(var s=new n(i+22),a=0,u=this.u;a<u.length;a++){var h;hn(s,t,h=u[a],h.f,h.u,-h.c-2,r,h.o),t+=46+h.f.length+un(h.extra)+(h.o?h.o.length:0),r+=h.b}fn(s,t,this.u.length,i,r),this.ondata(null,s,!0),this.d=2},t.prototype.terminate=function(){for(var t=0,n=this.u;t<n.length;t++)n[t].t();this.d=2},t}();function dn(t,r,i){i||(i=r,r={}),"function"!=typeof i&&I(7);var e={};Qt(t,"",e,r);var o=Object.keys(e),s=o.length,a=0,u=0,h=s,f=Array(s),c=[],l=function(){for(var t=0;t<c.length;++t)c[t]()},p=function(t,n){xn(function(){i(t,n)})};xn(function(){p=i});var v=function(){var t=new n(u+22),r=a,i=u-a;u=0;for(var e=0;e<h;++e){var o=f[e];try{var s=o.c.length;hn(t,u,o,o.f,o.u,s);var c=30+o.f.length+un(o.extra),l=u+c;t.set(o.c,l),hn(t,a,o,o.f,o.u,s,u,o.m),a+=16+c+(o.m?o.m.length:0),u=l+s}catch(t){return p(t,null)}}fn(t,a,f.length,i,r),p(null,t)};s||v();for(var d=function(t){var n=o[t],r=e[n],i=r[0],h=r[1],d=V(),g=i.length;d.p(i);var y=nn(n),m=y.length,b=h.comment,w=b&&nn(b),x=w&&w.length,z=un(h.extra),k=0==h.level?0:8,M=function(r,i){if(r)l(),p(r,null);else{var e=i.length;f[t]=K(h,{size:g,crc:d.d(),c:i,f:y,m:w,u:m!=n.length||w&&b.length!=x,compression:k}),a+=30+m+z+e,u+=76+2*(m+z)+(x||0)+e,--s||v()}};if(m>65535&&M(I(11,0,1),null),k)if(g<16e4)try{M(null,kt(i,h))}catch(t){M(t,null)}else c.push(zt(i,h,M));else M(null,i)},g=0;g<h;++g)d(g);return l}function gn(t,r){r||(r={});var i={},e=[];Qt(t,"",i,r);var o=0,s=0;for(var a in i){var u=i[a],h=u[0],f=u[1],c=0==f.level?0:8,l=(M=nn(a)).length,p=f.comment,v=p&&nn(p),d=v&&v.length,g=un(f.extra);l>65535&&I(11);var y=c?kt(h,f):h,m=y.length,b=V();b.p(h),e.push(K(f,{size:h.length,crc:b.d(),c:y,f:M,m:v,u:l!=a.length||v&&p.length!=d,o:o,compression:c})),o+=30+l+g+m,s+=76+2*(l+g)+(d||0)+m}for(var w=new n(s+22),x=o,z=s-o,k=0;k<e.length;++k){var M;hn(w,(M=e[k]).o,M,M.f,M.u,M.c.length);var S=30+M.f.length+un(M.extra);w.set(M.c,M.o+S),hn(w,o,M,M.f,M.u,M.c.length,M.o,M.m),o+=16+S+(M.m?M.m.length:0)}return fn(w,o,e.length,z,x),w}_e.Zip=vn;var yn=function(){function t(){}return t.prototype.push=function(t,n){this.ondata(null,t,n)},t.compression=0,t}();_e.UnzipPassThrough=yn;var mn=function(){function t(){var t=this;this.i=new Mt(function(n,r){t.ondata(null,n,r)})}return t.prototype.push=function(t,n){try{this.i.push(t,n)}catch(t){this.ondata(t,null,n)}},t.compression=8,t}();_e.UnzipInflate=mn;var bn=function(){function t(t,n){var r=this;n<32e4?this.i=new Mt(function(t,n){r.ondata(null,t,n)}):(this.i=new St(function(t,n,i){r.ondata(t,n,i)}),this.terminate=this.i.terminate)}return t.prototype.push=function(t,n){this.i.terminate&&(t=D(t,0)),this.i.push(t,n)},t.compression=8,t}();_e.AsyncUnzipInflate=bn;var wn=function(){function t(t){this.onfile=t,this.k=[],this.o={0:yn},this.p=j}return t.prototype.push=function(t,r){var i=this;if(this.onfile||I(5),this.p||I(4),this.c>0){var e=Math.min(this.c,t.length),o=t.subarray(0,e);if(this.c-=e,this.d?this.d.push(o,!this.c):this.k[0].push(o),(t=t.subarray(e)).length)return this.push(t,r)}else{var s=0,a=0,u=void 0,h=void 0;this.p.length?t.length?((h=new n(this.p.length+t.length)).set(this.p),h.set(t,this.p.length)):h=this.p:h=t;for(var f=h.length,c=this.c,l=c&&this.d,p=function(){var t=ft(h,a);if(67324752==t){s=1,u=a,v.d=null,v.c=0;var n=ht(h,a+6),r=ht(h,a+8),e=2048&n,o=8&n,l=ht(h,a+26),p=ht(h,a+28);if(f>a+30+l+p){var d=[];v.k.unshift(d),s=2;var g,y=ft(h,a+18),m=ft(h,a+22),b=rn(h.subarray(a+30,a+=30+l),!e),w=an(h,a,p,2,y,m,0),x=w[0],z=w[1];o&&(x=-1-w[3]),a+=p,v.c=x;var k={name:b,compression:r,start:function(){if(k.ondata||I(5),x){var t=i.o[r];t||k.ondata(I(14,"unknown compression type "+r,1),null,!1),(g=x<0?new t(b):new t(b,x,z)).ondata=function(t,n,r){k.ondata(t,n,r)};for(var n=0,e=d;n<e.length;n++)g.push(e[n],!1);i.k[0]==d&&i.c?i.d=g:g.push(j,!0)}else k.ondata(null,j,!0)},terminate:function(){g&&g.terminate&&g.terminate()}};x>=0&&(k.size=x,k.originalSize=z),v.onfile(k)}return"break"}if(c){if(134695760==t)return u=a+=12+(-2==c&&8),s=3,v.c=0,"break";if(33639248==t)return u=a-=4,s=3,v.c=0,"break"}},v=this;a<f-4&&"break"!==p();++a);if(this.p=j,c<0){var d=h.subarray(0,s?u-12-(-2==c&&8)-(134695760==ft(h,u-16)&&4):a);l?l.push(d,!!s):this.k[+(2==s)].push(d)}if(2&s)return this.push(h.subarray(a),r);this.p=h.subarray(a)}r&&(this.c&&I(13),this.p=null)},t.prototype.register=function(t){this.o[t.compression]=t},t}();_e.Unzip=wn;var xn="function"==typeof queueMicrotask?queueMicrotask:"function"==typeof setTimeout?setTimeout:function(t){t()};function zn(t,r,i){i||(i=r,r={}),"function"!=typeof i&&I(7);var e=[],o=function(){for(var t=0;t<e.length;++t)e[t]()},s={},a=function(t,n){xn(function(){i(t,n)})};xn(function(){a=i});for(var u=t.length-22;101010256!=ft(t,u);--u)if(!u||t.length-u>65558)return a(I(13,0,1),null),o;var h=ht(t,u+8);if(h){var f=h,c=ft(t,u+16),l=117853008==ft(t,u-20);if(l){var p=ft(t,u-12);(l=101075792==ft(t,p))&&(f=h=ft(t,p+32),c=ft(t,p+48))}for(var v=r&&r.filter,d=function(r){var i=sn(t,c,l),u=i[0],f=i[1],p=i[2],d=i[3],g=i[4],y=on(t,i[5]);c=g;var m=function(t,n){t?(o(),a(t,null)):(n&&(s[d]=n),--h||a(null,s))};if(!v||v({name:d,size:f,originalSize:p,compression:u}))if(u)if(8==u){var b=t.subarray(y,y+f);if(p<524288||f>.8*p)try{m(null,Tt(b,{out:new n(p)}))}catch(t){m(t,null)}else e.push(At(b,{size:p},m))}else m(I(14,"unknown compression type "+u,1),null);else m(null,D(t,y,y+f));else m(null,null)},g=0;g<f;++g)d()}else a(null,{});return o}function kn(t,r){for(var i={},e=t.length-22;101010256!=ft(t,e);--e)(!e||t.length-e>65558)&&I(13);var o=ht(t,e+8);if(!o)return{};var s=ft(t,e+16),a=117853008==ft(t,e-20);if(a){var u=ft(t,e-12);(a=101075792==ft(t,u))&&(o=ft(t,u+32),s=ft(t,u+48))}for(var h=r&&r.filter,f=0;f<o;++f){var c=sn(t,s,a),l=c[0],p=c[1],v=c[2],d=c[3],g=c[4],y=on(t,c[5]);s=g,h&&!h({name:d,size:p,originalSize:v,compression:l})||(l?8==l?i[d]=Tt(t.subarray(y,y+p),{out:new n(v)}):I(14,"unknown compression type "+l):i[d]=D(t,y,y+p))}return i}return _e});


/* ===================== src/engine.js ===================== */
/*
 * engine.js — ClinCheck WCC bundle  ->  seated teeth meshes (STL / GLB)
 *
 * Pure-JS port of the validated Python pipeline (lats_common.py / build_model.py).
 * Runs unchanged in:
 *   - the browser (extension content script): expects globalThis.CTM + globalThis.fflate
 *     to already exist (lib/lzma.js, lib/ctm.js, lib/fflate.umd.js loaded first)
 *   - node (test harness): the harness sets global.CTM / global.fflate before require()
 *
 * What it does, given the WCC .zip the ClinCheck viewer downloads:
 *   1. unzip            -> { filename: Uint8Array }
 *   2. decode each Tooth-<id>.ctm (OpenCTM MG2)         -> vertices (meters), faces
 *   3. move each tooth to the requested aligner stage   (per-tooth motion, teeth.json)
 *   4. seat both arches into occlusion                  (jaw-pair chain, jaws.json)
 *   5. export upper / lower / full-mouth STL  + a white-teeth GLB
 *   6. (optional) register the REAL gums ripped from WebGL (opts.glMeshes) onto the exact
 *      teeth and export teeth+gums STL/GLB — see registerGums().
 *
 * Arch is derived from dentalTypeID (Universal Numbering System: 1-16 upper, 17-32 lower),
 * so it is patient-independent — no hardcoded tooth-id sets.
 *
 * The gum is generated by the viewer's WASM and never downloaded; webgl_capture.js rips it at
 * the GPU-upload boundary, and registerGums() seats it with the exact same chain as the teeth.
 */
(function (root) {
  "use strict";

  var CTM    = (typeof globalThis !== "undefined" && globalThis.CTM)    || root.CTM;
  var fflate = (typeof globalThis !== "undefined" && globalThis.fflate) || root.fflate;

  var MM = 1000.0; // meters -> millimeters

  // ----------------------------------------------------------------- math
  // quaternion [x,y,z,w] -> row-major 3x3 rotation matrix (matches lats_common.quatR)
  function quatToMat3(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var n = Math.hypot(x, y, z, w) || 1;
    x /= n; y /= n; z /= n; w /= n;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w),
      2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)
    ];
  }

  // out = R * (p - origin) + origin + translate   (R row-major, all 3-vectors)
  function rotateAboutAdd(p, R, origin, translate) {
    var a = p[0] - origin[0], b = p[1] - origin[1], c = p[2] - origin[2];
    return [
      R[0] * a + R[1] * b + R[2] * c + origin[0] + translate[0],
      R[3] * a + R[4] * b + R[5] * c + origin[1] + translate[1],
      R[6] * a + R[7] * b + R[8] * c + origin[2] + translate[2]
    ];
  }

  function isIdentityMotion(m) {
    var r = m.rotation, p = m.position;
    return r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 1 &&
           p[0] === 0 && p[1] === 0 && p[2] === 0;
  }

  // sanity bounds on untrusted input (a real ClinCheck tooth is < 2k verts; the bundle ~1.3 MB)
  var LIMITS = { vc: 5000000, tc: 10000000, zipIn: 96 * 1024 * 1024, entries: 5000, outBytes: 512 * 1024 * 1024 };
  function i32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)); }

  // ----------------------------------------------------------------- CTM decode
  // bytes: Uint8Array of a .ctm file  ->  { vertices: Float32Array(meters), faces: Uint32Array }
  function decodeCTM(bytes) {
    if (!bytes || bytes.length < 36) throw new Error("CTM too small");
    // peek the header counts BEFORE CTM.File allocates buffers from them (reject zip-bomb-style meshes)
    var vc = i32le(bytes, 12), tc = i32le(bytes, 16);
    if (vc < 0 || tc < 0 || vc > LIMITS.vc || tc > LIMITS.tc)
      throw new Error("CTM rejected: implausible counts " + vc + "v/" + tc + "f");
    var stream = new CTM.Stream(bytes);
    stream.offset = 0;
    var file = new CTM.File(stream);
    return { vertices: file.body.vertices, faces: file.body.indices };
  }

  // ----------------------------------------------------------------- seating (jaws.json)
  function makeSeater(jawPair) {
    var U = jawPair.upper, L = jawPair.lower;
    var s = {
      Ub: U.basis, RU: quatToMat3(U.motion["0"].rotation), Up: U.motion["0"].position,
      Lb: L.basis, RL: quatToMat3(L.motion["0"].rotation), Lp: L.motion["0"].position,
      rc: jawPair.rotationCenter, Rg: quatToMat3(jawPair.rotation), gp: jawPair.position
    };
    // p: [x,y,z] meters (arch-local)  ->  [x,y,z] mm (seated/world)
    s.seat = function (p, arch) {
      var q = (arch === "U")
        ? rotateAboutAdd(p, s.RU, s.Ub, s.Up)
        : rotateAboutAdd(p, s.RL, s.Lb, s.Lp);
      var w = rotateAboutAdd(q, s.Rg, s.rc, s.gp);
      return [w[0] * MM, w[1] * MM, w[2] * MM];
    };
    return s;
  }

  // quaternion slerp [x,y,z,w] — matches the viewer's per-tooth keyframe interpolation
  function slerp(a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
    var dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
    if (dot > 0.9995) {                                   // nearly colinear: lerp + normalize
      var rx = ax + t * (bx - ax), ry = ay + t * (by - ay), rz = az + t * (bz - az), rw = aw + t * (bw - aw);
      var n = Math.hypot(rx, ry, rz, rw) || 1; return [rx / n, ry / n, rz / n, rw / n];
    }
    var th0 = Math.acos(dot), s0 = Math.sin(th0), s1 = Math.sin((1 - t) * th0) / s0, s2 = Math.sin(t * th0) / s0;
    return [s1 * ax + s2 * bx, s1 * ay + s2 * by, s1 * az + s2 * bz, s1 * aw + s2 * bw];
  }

  // move a tooth's local vertex to a chosen aligner stage. Motion is keyframed (e.g. 0/10/21);
  // the viewer INTERPOLATES between keyframes, so we slerp the rotation + lerp the position to
  // the exact stage instead of snapping to the nearest keyframe.
  function toothStageMotion(tooth, stage) {
    var keys = [];
    for (var k in tooth.motion) keys.push(parseInt(k, 10));
    if (!keys.length) return null;
    keys.sort(function (a, b) { return a - b; });
    if (stage <= keys[0]) stage = keys[0];
    else if (stage >= keys[keys.length - 1]) stage = keys[keys.length - 1];
    var lo = keys[0], hi = keys[keys.length - 1];
    for (var i = 0; i < keys.length; i++) { if (keys[i] <= stage) lo = keys[i]; if (keys[i] >= stage) { hi = keys[i]; break; } }
    var mlo = tooth.motion[String(lo)], mhi = tooth.motion[String(hi)], rot, pos;
    if (lo === hi) { rot = mlo.rotation; pos = mlo.position; }
    else {
      var t = (stage - lo) / (hi - lo);
      rot = slerp(mlo.rotation, mhi.rotation, t);
      pos = [mlo.position[0] + t * (mhi.position[0] - mlo.position[0]),
             mlo.position[1] + t * (mhi.position[1] - mlo.position[1]),
             mlo.position[2] + t * (mhi.position[2] - mlo.position[2])];
    }
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0 && rot[3] === 1 && pos[0] === 0 && pos[1] === 0 && pos[2] === 0) return null;
    return { R: quatToMat3(rot), basis: tooth.basis, pos: pos };
  }

  // total aligner-stage range in the bundle (used to identify the viewer's step control)
  function stageRange(zipBytes) {
    var files = unzip(zipBytes);
    var teethMeta = readJSON(files, "teeth.json");
    var maxAll = 0, maxU = 0, maxL = 0;
    for (var i = 0; i < teethMeta.length; i++) {
      var t = teethMeta[i], arch = archOf(t), mx = 0;
      for (var k in t.motion) { var ki = parseInt(k, 10); if (ki > mx) mx = ki; }
      if (mx > maxAll) maxAll = mx;
      if (arch === "U" && mx > maxU) maxU = mx;
      if (arch === "L" && mx > maxL) maxL = mx;
    }
    return { max: maxAll, upper: maxU, lower: maxL };
  }

  function archOf(tooth) {
    // Universal Numbering System: 1-16 upper, 17-32 lower
    var uns = tooth.dentalTypeID != null ? tooth.dentalTypeID : tooth.number;
    return uns <= 16 ? "U" : "L";
  }

  // ----------------------------------------------------------------- bundle helpers
  function unzip(zipBytes) {
    if (!zipBytes || zipBytes.length > LIMITS.zipIn) throw new Error("zip too large / missing");
    var raw = fflate.unzipSync(zipBytes);
    var keys = Object.keys(raw);
    if (keys.length > LIMITS.entries) throw new Error("zip has too many entries");
    var files = {};
    for (var i = 0; i < keys.length; i++) files[keys[i].split("/").pop()] = raw[keys[i]]; // flatten to basenames
    return files;
  }
  function readJSON(files, name) {
    var b = files[name];
    if (!b) throw new Error("missing " + name + " in WCC bundle");
    return JSON.parse(new TextDecoder("utf-8").decode(b));
  }

  // ----------------------------------------------------------------- seated tooth set
  // Returns { teeth: [ {id, uns, arch, seq, verts:Float32Array(mm), faces:Uint32Array, widthMM} ],
  //           seater, stage }
  function buildSeatedTeeth(files, stage) {
    stage = stage || 0;
    var jawPair = readJSON(files, "jaws.json")[0];
    var teethMeta = readJSON(files, "teeth.json");
    var seater = makeSeater(jawPair);

    var teeth = [];
    for (var i = 0; i < teethMeta.length; i++) {
      var t = teethMeta[i];
      var ctmName = "Tooth-" + t.id + ".ctm";
      if (!files[ctmName]) continue;               // pontic / missing tooth: no mesh
      var arch = archOf(t);
      var dec = decodeCTM(files[ctmName]);
      var sv = dec.vertices;                        // Float32Array meters, length 3N
      var N = sv.length / 3;
      var motion = toothStageMotion(t, stage);
      var out = new Float32Array(sv.length);
      var minx = Infinity, maxx = -Infinity;
      for (var j = 0; j < N; j++) {
        var p = [sv[3 * j], sv[3 * j + 1], sv[3 * j + 2]];
        if (motion) p = rotateAboutAdd(p, motion.R, motion.basis, motion.pos);
        var w = seater.seat(p, arch);
        out[3 * j] = w[0]; out[3 * j + 1] = w[1]; out[3 * j + 2] = w[2];
        if (w[0] < minx) minx = w[0];
        if (w[0] > maxx) maxx = w[0];
      }
      teeth.push({
        id: t.id, uns: (t.dentalTypeID != null ? t.dentalTypeID : t.number), arch: arch,
        verts: out, faces: dec.faces, widthMM: maxx - minx,
        rawVerts: sv                                  // pre-seat meters, for WebGL-rip matching
      });
    }
    // canonical left-to-right ordering by UNS within each arch
    teeth.sort(function (a, b) { return a.uns - b.uns; });
    var seqU = 0, seqL = 0;
    for (var s = 0; s < teeth.length; s++) {
      teeth[s].seq = teeth[s].arch === "U" ? ++seqU : ++seqL;
    }
    return { teeth: teeth, seater: seater, stage: stage };
  }

  // ----------------------------------------------------------------- STL (binary)
  // a face index past the vertex array would write NaN triangles into a file that still parses
  function checkFaces(verts, faces) {
    var nV = verts.length / 3;
    if (faces.length % 3) throw new Error("mesh faces are not triangles");
    for (var i = 0; i < faces.length; i++) if (!(faces[i] < nV)) throw new Error("mesh has a face index past its vertices");
  }

  // glTF writes accessor min/max as JSON, where Infinity/NaN become null and importers (Blender)
  // reject the whole file. Real exports never hit this; it guards against junk ripped draws.
  function allFinite(arr) { for (var i = 0; i < arr.length; i++) if (!isFinite(arr[i])) return false; return true; }
  function safeColor(c) {
    if (!c || c.length !== 4) return [0.8, 0.8, 0.8, 1];
    return [0, 1, 2, 3].map(function (i) { var v = +c[i]; return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; });
  }

  function concatMeshes(meshes) {
    var nV = 0, nF = 0, m;
    for (var i = 0; i < meshes.length; i++) { nV += meshes[i].verts.length / 3; nF += meshes[i].faces.length / 3; }
    var verts = new Float32Array(nV * 3), faces = new Uint32Array(nF * 3);
    var vo = 0, fo = 0, vbase = 0;
    for (i = 0; i < meshes.length; i++) {
      m = meshes[i];
      checkFaces(m.verts, m.faces);
      verts.set(m.verts, vo);
      for (var k = 0; k < m.faces.length; k++) faces[fo + k] = m.faces[k] + vbase;
      vbase += m.verts.length / 3;
      vo += m.verts.length; fo += m.faces.length;
    }
    return { verts: verts, faces: faces };
  }

  function buildSTL(meshes, header) {
    var m = concatMeshes(meshes);
    var V = m.verts, F = m.faces, nTri = F.length / 3;
    if (nTri < 0 || 84 + nTri * 50 > LIMITS.outBytes) throw new Error("mesh too large for STL");
    var buf = new ArrayBuffer(84 + nTri * 50);
    var dv = new DataView(buf);
    var head = "Teeth Exporter (unofficial) " + (header || "");
    for (var h = 0; h < 80; h++) dv.setUint8(h, h < head.length ? head.charCodeAt(h) & 0x7f : 0);
    dv.setUint32(80, nTri, true);
    var off = 84;
    for (var t = 0; t < nTri; t++) {
      var a = F[3 * t] * 3, b = F[3 * t + 1] * 3, c = F[3 * t + 2] * 3;
      var ax = V[a], ay = V[a + 1], az = V[a + 2];
      var bx = V[b], by = V[b + 1], bz = V[b + 2];
      var cx = V[c], cy = V[c + 1], cz = V[c + 2];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
      dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
      dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
      dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
    return new Uint8Array(buf);
  }

  // ----------------------------------------------------------------- GLB (glTF 2.0 binary)
  // objects: [ { name, verts:Float32Array, faces:Uint32Array, color:[r,g,b,a] 0..1 } ]
  // opts.unitScale: node scale to meters. glTF is meters by spec, so millimeter verts pass 0.001
  // and Blender & co import at true size (the vertex data itself stays mm, bit-exact).
  function buildGLB(objects, opts) {
    var unitScale = opts && opts.unitScale;
    var json = {
      asset: { version: "2.0", generator: "Teeth Exporter (unofficial)" },
      scene: 0, scenes: [{ nodes: [] }], nodes: [],
      meshes: [], materials: [], accessors: [], bufferViews: [], buffers: []
    };
    var blobs = [];   // Uint8Array chunks of binary data
    var byteLen = 0;
    function align4(arr) { var pad = (4 - (arr.byteLength % 4)) % 4; if (pad) { blobs.push(new Uint8Array(pad)); byteLen += pad; } }

    for (var o = 0; o < objects.length; o++) {
      var ob = objects[o];
      var V = ob.verts, F = ob.faces;
      checkFaces(V, F);
      if (!allFinite(V)) throw new Error("mesh " + ob.name + " has invalid vertex values");
      // positions accessor
      var posBytes = new Uint8Array(V.buffer, V.byteOffset, V.byteLength);
      var posView = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: V.byteLength, target: 34962 });
      blobs.push(posBytes); byteLen += V.byteLength; align4(posBytes);
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < V.length; i += 3) for (var k = 0; k < 3; k++) { var val = V[i + k]; if (val < mn[k]) mn[k] = val; if (val > mx[k]) mx[k] = val; }
      var posAcc = json.accessors.length;
      json.accessors.push({ bufferView: posView, componentType: 5126, count: V.length / 3, type: "VEC3", min: mn, max: mx });
      // indices accessor (uint32)
      var idxBytes = new Uint8Array(F.buffer, F.byteOffset, F.byteLength);
      var idxView = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: F.byteLength, target: 34963 });
      blobs.push(idxBytes); byteLen += F.byteLength; align4(idxBytes);
      var idxAcc = json.accessors.length;
      json.accessors.push({ bufferView: idxView, componentType: 5125, count: F.length, type: "SCALAR" });
      // material
      var mat = json.materials.length;
      json.materials.push({ name: ob.name + "_mat", pbrMetallicRoughness: { baseColorFactor: safeColor(ob.color), metallicFactor: 0.0, roughnessFactor: 0.7 } });
      // mesh + node
      var mesh = json.meshes.length;
      json.meshes.push({ name: ob.name, primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, material: mat }] });
      var node = { name: ob.name, mesh: mesh };
      if (unitScale && unitScale !== 1) node.scale = [unitScale, unitScale, unitScale];
      json.nodes.push(node);
      json.scenes[0].nodes.push(json.nodes.length - 1);
    }
    json.buffers.push({ byteLength: byteLen });

    // assemble BIN chunk
    var bin = new Uint8Array(byteLen), p = 0;
    for (var bI = 0; bI < blobs.length; bI++) { bin.set(blobs[bI], p); p += blobs[bI].byteLength; }
    // JSON chunk (pad with spaces to 4-byte)
    var jsonStr = JSON.stringify(json);
    var jsonBytes = new TextEncoder().encode(jsonStr);
    var jpad = (4 - (jsonBytes.byteLength % 4)) % 4;
    var jsonChunk = new Uint8Array(jsonBytes.byteLength + jpad);
    jsonChunk.set(jsonBytes); for (var sp = 0; sp < jpad; sp++) jsonChunk[jsonBytes.byteLength + sp] = 0x20;
    var bpad = (4 - (bin.byteLength % 4)) % 4;
    var binChunkLen = bin.byteLength + bpad;

    var total = 12 + 8 + jsonChunk.byteLength + 8 + binChunkLen;
    var out = new Uint8Array(total);
    var ov = new DataView(out.buffer);
    ov.setUint32(0, 0x46546c67, true);          // "glTF"
    ov.setUint32(4, 2, true);                    // version
    ov.setUint32(8, total, true);                // total length
    ov.setUint32(12, jsonChunk.byteLength, true);
    ov.setUint32(16, 0x4e4f534a, true);          // "JSON"
    out.set(jsonChunk, 20);
    var binOff = 20 + jsonChunk.byteLength;
    ov.setUint32(binOff, binChunkLen, true);
    ov.setUint32(binOff + 4, 0x004e4942, true);  // "BIN\0"
    out.set(bin, binOff + 8);
    return out;
  }

  // ----------------------------------------------------------------- real gum registration
  // The ClinCheck WASM generates the gum and uploads it to WebGL in the SAME raw (pre-seat,
  // meters) frame as the Tooth-*.ctm vertices. webgl_capture.js rips every drawn mesh; here we
  //   1. match each ripped mesh to a Tooth-*.ctm by sorted-vertex equality (proves shared frame),
  //   2. treat big unmatched draws as gum candidates,
  //   3. decide each gum's arch by PHYSICAL FIT (seat both ways, keep the arch its teeth hug),
  //   4. seat it with the exact same chain as the teeth.
  var GUM_MIN_VERTS = 2500;     // gum template ~5k verts; real teeth are < ~1800
  var MATCH_TOL = 1e-5;         // meters; ripped teeth match raw CTM to ~1e-9
  var AMBIG_MARGIN = 0.6;       // mm; below this the arch fit is a tie -> default lower

  // lexicographic sort of an interleaved xyz Float32Array -> new sorted Float32Array
  function sortedXYZ(v) {
    var n = v.length / 3, idx = new Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (a, b) {
      var ax = v[3 * a], bx = v[3 * b]; if (ax !== bx) return ax - bx;
      var ay = v[3 * a + 1], by = v[3 * b + 1]; if (ay !== by) return ay - by;
      return v[3 * a + 2] - v[3 * b + 2];
    });
    var out = new Float32Array(v.length);
    for (i = 0; i < n; i++) { var s = idx[i]; out[3 * i] = v[3 * s]; out[3 * i + 1] = v[3 * s + 1]; out[3 * i + 2] = v[3 * s + 2]; }
    return out;
  }
  function maxAbsDiff(a, b) { var m = 0; for (var i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; }

  // median nearest-neighbour distance (mm) from a sample of src points to all dst points
  function medianNearest(src, dst, sampleN) {
    var ns = src.length / 3, nd = dst.length / 3;
    var step = Math.max(1, Math.floor(ns / sampleN));
    var dists = [];
    for (var i = 0; i < ns; i += step) {
      var x = src[3 * i], y = src[3 * i + 1], z = src[3 * i + 2], best = Infinity;
      for (var j = 0; j < nd; j++) {
        var dx = x - dst[3 * j], dy = y - dst[3 * j + 1], dz = z - dst[3 * j + 2];
        var d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      dists.push(Math.sqrt(best));
    }
    dists.sort(function (a, b) { return a - b; });
    return dists.length ? dists[dists.length >> 1] : Infinity;
  }

  function seatArray(seater, verts, arch) {
    var out = new Float32Array(verts.length);
    for (var i = 0; i < verts.length; i += 3) {
      var w = seater.seat([verts[i], verts[i + 1], verts[i + 2]], arch);
      out[i] = w[0]; out[i + 1] = w[1]; out[i + 2] = w[2];
    }
    return out;
  }

  // seated: result of buildSeatedTeeth. glMeshes: [{ positions:Float32Array(meters), indices:Uint32Array }]
  // returns { gums: [{arch, verts:Float32Array(mm), faces:Uint32Array, cost}], matched, worstMatch, info }
  function registerGums(seated, glMeshes) {
    if (!glMeshes || !glMeshes.length) return { gums: [], matched: 0, info: "no ripped meshes" };
    var teeth = seated.teeth, seater = seated.seater;
    // precompute each tooth's sorted raw verts
    var toothSorted = teeth.map(function (t) { return { t: t, n: t.rawVerts.length / 3, sorted: sortedXYZ(t.rawVerts) }; });
    // per-arch seated teeth point clouds (for the fit test)
    var cloud = { U: [], L: [] };
    for (var ti = 0; ti < teeth.length; ti++) { var arr = cloud[teeth[ti].arch]; if (arr) arr.push(teeth[ti].verts); }
    var seatedCloud = {};
    ["U", "L"].forEach(function (a) { seatedCloud[a] = cloud[a].length ? concatMeshes(cloud[a].map(function (v) { return { verts: v, faces: new Uint32Array(0) }; })).verts : null; });

    var candidates = [], matched = 0, worst = 0;
    for (var g = 0; g < glMeshes.length; g++) {
      var m = glMeshes[g];
      var pos = m.positions; if (!pos || !pos.length) continue;
      // only plain triangle lists can be a gum: a strip / fan / line draw has different
      // connectivity and would export garbage faces (GL TRIANGLES = 4)
      if (m.meta && m.meta.mode != null && m.meta.mode !== 4) continue;
      var n = pos.length / 3;
      // try to match to a tooth (same count + sorted-vertex equality)
      var isTooth = false, srt = null;
      for (var k = 0; k < toothSorted.length; k++) {
        if (toothSorted[k].n !== n) continue;
        if (!srt) srt = sortedXYZ(pos);
        var d = maxAbsDiff(srt, toothSorted[k].sorted);
        if (d < MATCH_TOL) { isTooth = true; matched++; if (d > worst) worst = d; break; }
      }
      if (isTooth) continue;
      if (n >= GUM_MIN_VERTS) candidates.push({ positions: pos, indices: m.indices, n: n });
    }

    // cost[gum][arch] = how well the seated gum hugs that arch's teeth
    var archesPresent = ["U", "L"].filter(function (a) { return seatedCloud[a]; });
    candidates.forEach(function (c) {
      c.cost = {};
      archesPresent.forEach(function (a) {
        c.cost[a] = medianNearest(seatArray(seater, c.positions, a), seatedCloud[a], 500);
      });
    });

    // assign arches
    assignArches(candidates, archesPresent);

    // keep only the BEST-fitting gum per arch: scrubbing aligner steps makes the viewer
    // regenerate the gum, so a session can hold several near-identical variants per arch —
    // exporting them all would stack overlapping shells. Cost is measured against the teeth
    // at the EXPORTED stage, so the lowest-cost variant is also the stage-appropriate one.
    var bestByArch = {};
    candidates.forEach(function (c) {
      if (!c.arch) return;
      var cur = bestByArch[c.arch];
      if (!cur || (c.cost[c.arch] || Infinity) < (cur.cost[cur.arch] || Infinity)) bestByArch[c.arch] = c;
    });
    var gums = Object.keys(bestByArch).map(function (a) {
      var c = bestByArch[a];
      return { arch: a, verts: seatArray(seater, c.positions, a),
        faces: c.indices ? Uint32Array.from(c.indices) : new Uint32Array(0), cost: +(c.cost[a] || 0).toFixed(3) };
    });
    return { gums: gums, matched: matched, worstMatch: worst,
      info: candidates.length + " gum candidate(s), " + gums.length + " placed (best per arch)" };
  }

  // pick each gum's arch by physical fit. A gum with a decisive margin claims its best arch
  // (the upper gum always is — proven ~2.3mm vs ~4.7mm). An ambiguous gum (the lower fits both
  // arches within AMBIG_MARGIN) goes to whichever arch has NO decisive claimant — the decisive
  // gum anchors the assignment — else defaults to lower. Works for any candidate count, so
  // stage-scrubbed captures with several regenerated variants per arch assign correctly.
  function assignArches(cands, arches) {
    if (!cands.length || !arches.length) return;
    if (arches.length === 1) { cands.forEach(function (c) { c.arch = arches[0]; }); return; }
    var decided = {}, ambiguous = [];
    cands.forEach(function (c) {
      var cu = c.cost.U, cl = c.cost.L;
      if (Math.abs(cu - cl) >= AMBIG_MARGIN) { c.arch = (cu < cl) ? "U" : "L"; decided[c.arch] = true; }
      else ambiguous.push(c);
    });
    ambiguous.forEach(function (c) {
      if (decided.U && !decided.L) c.arch = "L";
      else if (decided.L && !decided.U) c.arch = "U";
      else c.arch = "L";                                  // no anchor (or both claimed): default lower
    });
  }

  // ----------------------------------------------------------------- top-level
  // zipBytes: Uint8Array of the WCC .zip. opts: { stage, glb }
  // returns { outputs: { name: Uint8Array }, manifest: [...], stats: {...} }
  function exportFromBundle(zipBytes, opts) {
    opts = opts || {};
    var stage = opts.stage || 0;
    var files = unzip(zipBytes);
    var seated = buildSeatedTeeth(files, stage);
    var teeth = seated.teeth;
    if (!teeth.length) throw new Error("no tooth meshes found in bundle");

    var upper = teeth.filter(function (t) { return t.arch === "U"; });
    var lower = teeth.filter(function (t) { return t.arch === "L"; });

    var WHITE = [0.925, 0.914, 0.878, 1.0];
    var PINK = [0.86, 0.42, 0.44, 1.0];

    // optional: register the real gums ripped from WebGL (opts.glMeshes) onto the exact teeth
    var gumReg = null, gumByArch = {};
    if (opts.glMeshes && opts.glMeshes.length) {
      gumReg = registerGums(seated, opts.glMeshes);
      gumReg.gums.forEach(function (gm) { gumByArch[gm.arch] = gm; });
    }
    var gums = gumReg ? gumReg.gums : [];

    // ---- STL export matrix: {full mouth, upper, lower} × {teeth, gums, teeth+gums} ----
    var outputs = {};
    // teeth only
    outputs["full_mouth_teeth.stl"] = buildSTL(teeth, "full teeth stage " + stage);
    if (upper.length) outputs["upper_teeth.stl"] = buildSTL(upper, "upper teeth stage " + stage);
    if (lower.length) outputs["lower_teeth.stl"] = buildSTL(lower, "lower teeth stage " + stage);
    if (gums.length) {
      // teeth + gums
      outputs["full_mouth_with_gums.stl"] = buildSTL(teeth.concat(gums), "full teeth+gums stage " + stage);
      // gums only
      outputs["full_mouth_gums.stl"] = buildSTL(gums, "gums only");
      // per-arch gum-only + arch teeth+gum
      [["U", "upper", upper], ["L", "lower", lower]].forEach(function (a) {
        var key = a[0], name = a[1], archTeeth = a[2], gm = gumByArch[key];
        if (!gm) return;
        outputs["gum_" + key + ".stl"] = buildSTL([gm], "real " + name + " gum");
        if (archTeeth.length) outputs[name + "_with_gums.stl"] = buildSTL(archTeeth.concat([gm]), name + " teeth+gum stage " + stage);
      });
    }

    var merged = concatMeshes(teeth);   // used for the parity stats below

    // ---- GLB: upper teeth / lower teeth / each gum as SEPARATE colored meshes ----
    if (opts.glb !== false) {
      var objs = [];
      if (upper.length) { var mu = concatMeshes(upper); objs.push({ name: "teeth_upper", verts: mu.verts, faces: mu.faces, color: WHITE }); }
      if (lower.length) { var ml = concatMeshes(lower); objs.push({ name: "teeth_lower", verts: ml.verts, faces: ml.faces, color: WHITE }); }
      gums.forEach(function (gm) { objs.push({ name: "gum_" + gm.arch, verts: gm.verts, faces: gm.faces, color: PINK }); });
      outputs[gums.length ? "full_mouth.glb" : "full_mouth_teeth.glb"] = buildGLB(objs, { unitScale: 0.001 });
    }

    var manifest = teeth.map(function (t) {
      return { arch: t.arch, seq: t.seq, uns: t.uns, id: t.id, widthMM: +t.widthMM.toFixed(3) };
    });

    // stats for QA / parity checks
    var all = merged;
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
    for (var i = 0; i < all.verts.length; i += 3) for (var k = 0; k < 3; k++) { var v = all.verts[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; sum[k] += v; }
    var nV = all.verts.length / 3;
    var stats = { teeth: teeth.length, vertices: nV, faces: all.faces.length / 3,
      bboxMin: mn, bboxMax: mx, centroid: [sum[0] / nV, sum[1] / nV, sum[2] / nV] };
    if (gumReg) stats.gums = gumReg.gums.map(function (g) { return { arch: g.arch, verts: g.verts.length / 3, faces: g.faces.length / 3, fitMM: g.cost }; });

    return { outputs: outputs, manifest: manifest, stats: stats, gumInfo: gumReg };
  }

  // bundle a set of named Uint8Arrays into one .zip (for a single download)
  // One stage's files arranged for people: the everyday files at the top of the stage folder,
  // everything else under Advanced/. Top = full mouth + upper + lower, teeth WITH gums, plus the GLB.
  // An arch with no captured gum falls back to its teeth-only STL at the top, so the top level always
  // holds one full-mouth, one upper and one lower file.
  function layoutStage(outputs, dir) {
    var top = {}, placed = {}, out = {};
    function pick(pref, fallback) { var n = outputs[pref] ? pref : (outputs[fallback] ? fallback : null); if (n) { top[n] = true; } }
    pick("full_mouth_with_gums.stl", "full_mouth_teeth.stl");
    pick("upper_with_gums.stl", "upper_teeth.stl");
    pick("lower_with_gums.stl", "lower_teeth.stl");
    pick("full_mouth.glb", "full_mouth_teeth.glb");
    for (var name in outputs) {
      out[dir + (top[name] ? "" : "Advanced/") + name] = outputs[name];
      placed[name] = true;
    }
    return out;
  }

  function stageDirName(s, max) {
    var width = Math.max(2, String(max).length);
    return "stage_" + ("0000000" + s).slice(-width) + "/";
  }

  // Every aligner stage, TEETH ONLY, one folder each (layoutStage). The fallback when the viewer's
  // own controls aren't reachable to step it: gums change per step and only drawn steps can be ripped.
  function exportAllStages(zipBytes, opts) {
    opts = opts || {};
    var range = stageRange(zipBytes);
    var first = opts.firstStage != null ? opts.firstStage : 0;
    var last = opts.lastStage != null ? opts.lastStage : range.max;
    var outputs = {}, total = 0, manifest = null, teethCount = 0;
    for (var s = first; s <= last; s++) {
      var r = exportFromBundle(zipBytes, { stage: s, glb: true });
      var laid = layoutStage(r.outputs, stageDirName(s, last));
      for (var k in laid) {
        outputs[k] = laid[k];
        total += laid[k].byteLength;
        if (total > LIMITS.outBytes) throw new Error("all-stages export too large");
      }
      if (!manifest) { manifest = r.manifest; teethCount = r.stats.teeth; }
    }
    return { outputs: outputs, firstStage: first, maxStage: last, stageCount: last - first + 1, manifest: manifest, stats: { teeth: teethCount, bytes: total } };
  }

  function zipOutputs(outputs, extra) {
    var entries = {};
    for (var name in outputs) entries[name] = outputs[name];
    if (extra) for (var e in extra) entries[e] = extra[e];
    return fflate.zipSync(entries, { level: 6 });
  }

  var api = {
    MM: MM,
    decodeCTM: decodeCTM,
    buildSeatedTeeth: buildSeatedTeeth,
    stageRange: stageRange,
    buildSTL: buildSTL,
    buildGLB: buildGLB,
    registerGums: registerGums,
    exportFromBundle: exportFromBundle,
    zipOutputs: zipOutputs,
    exportAllStages: exportAllStages,
    layoutStage: layoutStage,
    stageDirName: stageDirName,
    LIMITS: LIMITS,
    allFinite: allFinite,
    unzip: unzip
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.ClinCheckEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);



/* ===================== src/stage_probe.js ===================== */
/*
 * stage_probe.js — detect which aligner step the viewer is currently showing, and watch it live.
 *
 * Per-tooth motion is sub-millimeter, so the step CANNOT be inferred from the 3D geometry — it has
 * to be read from the viewer's own step control. We don't know that control's markup a priori, so
 * we scan for the usual shapes (a range slider, an ARIA slider, or "X / Y" text) and disambiguate
 * using a fact we DO know: the bundle's total stage count. The control whose total matches the
 * plan's stage count is almost certainly the aligner stepper, not some unrelated slider.
 *
 * Exposes globalThis.TeethStageProbe(opts):
 *   opts.getMaxStage() -> number|null   the plan's max stage (from engine.stageRange); null = unknown
 *   opts.onChange(info)                 called when the detected step changes; info = {stage,current,total,source}
 *   returns { start(), stop(), get() }
 *
 * `stage` is OUR 0-based engine stage (0..max). `current`/`total` are the raw control values.
 */
(function (root) {
  "use strict";

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    var s = (root.getComputedStyle ? root.getComputedStyle(el) : null);
    return !s || (s.visibility !== "hidden" && s.display !== "none");
  }

  function TeethStageProbe(opts) {
    opts = opts || {};
    var getMax = opts.getMaxStage || function () { return null; };
    var onChange = opts.onChange || function () {};
    var cur = null, timer = null, observer = null, started = false;

    // collect candidate step controls with {current, total, min, source, score}
    function candidates() {
      var maxStage = getMax();                          // e.g. 21 (stages 0..21 -> 22 steps)
      var out = [];
      function add(current, total, min, source, baseScore) {
        if (current == null || total == null || total < 2 || total > 200) return;
        var score = baseScore;
        if (maxStage != null) {
          if (total === maxStage || total === maxStage + 1) score += 100;      // exact (0- or 1-indexed)
          else if (Math.abs(total - maxStage) <= 1) score += 40;
          else score -= 30;                                                    // unlikely the stepper
        }
        out.push({ current: current, total: total, min: min == null ? 0 : min, source: source, score: score });
      }
      // 1) native range sliders
      var ranges = root.document.querySelectorAll('input[type="range"]');
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i]; if (!visible(r)) continue;
        var mn = num(r.min) || 0, mx = num(r.max), v = num(r.value);
        if (mx != null && v != null) add(v, mx, mn, "range", 50);
      }
      // 2) ARIA sliders
      var aria = root.document.querySelectorAll('[role="slider"],[aria-valuemax]');
      for (var j = 0; j < aria.length; j++) {
        var a = aria[j]; if (!visible(a)) continue;
        var amn = num(a.getAttribute("aria-valuemin")) || 0;
        var amx = num(a.getAttribute("aria-valuemax")), av = num(a.getAttribute("aria-valuenow"));
        if (amx != null && av != null) add(av, amx, amn, "aria", 45);
      }
      // 3) "X / Y" or "X of Y" text, ideally near step/stage/aligner wording.
      // Skipped when a slider already matched the plan's stage count — this scan walks the DOM
      // and is only worth the cost as a fallback.
      if (out.some(function (c) { return c.score >= 85; })) { out.sort(function (p, q) { return q.score - p.score; }); return out; }
      try {
        var rx = /\b(\d{1,3})\s*(?:\/|of)\s*(\d{1,3})\b/;
        var nodes = root.document.querySelectorAll("body *");
        for (var k = 0; k < nodes.length && k < 4000; k++) {
          var el = nodes[k];
          if (el.children && el.children.length) continue;          // leaf text only
          var txt = (el.textContent || "").trim();
          if (txt.length > 40) continue;
          var m = rx.exec(txt);
          if (!m) continue;
          var c = num(m[1]), t = num(m[2]);
          var labelled = /step|stage|aligner|week/i.test((el.textContent || "") + " " + (el.getAttribute && (el.getAttribute("aria-label") || "") || ""));
          add(c, t, t === (getMax() + 1) ? 1 : 0, "text", labelled ? 35 : 10);
        }
      } catch (e) {}
      out.sort(function (p, q) { return q.score - p.score; });
      return out;
    }

    function read() {
      var maxStage = getMax();
      // without the plan's stage count there is nothing to disambiguate with, and any visible
      // slider (zoom, opacity) would latch as "the step". Don't guess.
      if (maxStage == null) return null;
      var c = candidates();
      if (!c.length) return null;
      // require a control whose total actually matches the plan (a +100 match or +40 near-match
      // bonus) — don't latch onto an unrelated slider.
      if (c[0].score < 85) return null;
      var best = c[0];
      // map to 0-based engine stage (stages 0..maxStage):
      //   total == maxStage+1  -> 1-indexed control (1..maxStage+1), even when min is missing
      //   total == maxStage, min 1 -> control counts stages 1..maxStage directly
      //   otherwise            -> offset by the control's min
      var offset = best.min;
      // text labels are 1-based aligner numbers: the live ClinCheck viewer shows "Aligner Number 1 / 21"
      // at stage 0 and "21 / 21" at stage 20 (verified 2026-10-19), so label N = stage N - 1
      if (best.source === "text") offset = 1;
      else if (best.total === maxStage + 1) offset = 1;
      else if (best.total === maxStage && best.min === 1) offset = 0;
      var stage = Math.max(0, Math.min(maxStage, Math.round(best.current - offset)));
      return { stage: stage, current: best.current, total: best.total, source: best.source };
    }

    function doTick() {
      var info = read();
      if (info && (cur == null || info.stage !== cur.stage || info.total !== cur.total)) {
        cur = info; try { onChange(info); } catch (e) {}
      }
    }
    // MutationObserver can fire on every DOM change in a busy SPA — throttle the actual scan
    // to at most one per 300ms (leading edge immediate, trailing edge scheduled).
    var lastTick = 0, tickTimer = null;
    function tick() {
      var now = Date.now();
      if (now - lastTick >= 300) { lastTick = now; doTick(); }
      else if (!tickTimer) {
        tickTimer = root.setTimeout(function () { tickTimer = null; lastTick = Date.now(); doTick(); }, 300 - (now - lastTick));
      }
    }

    function start() {
      if (started) return; started = true;
      // observe attribute (aria-valuenow / value) + text changes, plus a backing-off poll for SPAs
      try {
        observer = new root.MutationObserver(function () { tick(); });
        observer.observe(root.document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-valuenow", "value"] });
      } catch (e) {}
      try {
        root.document.addEventListener("input", tick, true);
        root.document.addEventListener("change", tick, true);
      } catch (e) {}
      var n = 0;
      timer = root.setInterval(function () { tick(); if (++n > 40) { root.clearInterval(timer); timer = root.setInterval(tick, 2500); } }, 700);
      tick();
    }
    function stop() {
      started = false;
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
      if (timer) { root.clearInterval(timer); timer = null; }
      if (tickTimer) { try { root.clearTimeout(tickTimer); } catch (e) {} tickTimer = null; }
    }
    return { start: start, stop: stop, get: function () { return cur; } };
  }

  root.TeethStageProbe = TeethStageProbe;
})(typeof globalThis !== "undefined" ? globalThis : this);



/* ===================== src/capture.js ===================== */
/*
 * capture.js — MAIN-world hook (runs in the page's own JS context, document_start).
 *
 * Two jobs:
 *   1. CAPTURE the WCC bundle (the ZIP the viewer loads from .../treatment_plan_video_wcc?...).
 *   2. DIAGNOSTICS: record EVERY mesh/archive-looking response the viewer fetches, so we can
 *      tell whether the gum surface arrives as a separate file we'd otherwise miss. Nothing
 *      leaves the device — records + bytes go only to our isolated content script.
 *
 * We patch fetch + XMLHttpRequest. Detection of the WCC bundle mirrors decode_har.py
 * (ZIP magic "PK" + url mentions wcc, or a large ZIP blob).
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckCaptureInstalled) return;
  window.__clincheckCaptureInstalled = true;

  var MAX_BYTES = 96 * 1024 * 1024;   // never buffer/forward responses larger than this

  // Per-load random token. capture.js runs at document_start (before the page's app code),
  // so it announces this token to content.js first; content.js then rejects any message that
  // doesn't carry it — a page script injected later can't have observed an earlier announce.
  var TOKEN = (function () {
    try {
      var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    } catch (e) { return "t" + String(Date.now ? Date.now() : 0) + Math.abs((Math.random ? Math.random() : 0.5) * 1e9 | 0); }
  })();

  // ---- format sniffing by magic bytes ----
  function s4(u8) { return String.fromCharCode(u8[0] | 0, u8[1] | 0, u8[2] | 0, u8[3] | 0); }
  function meshKind(u8) {
    if (!u8 || u8.length < 4) return null;
    if (u8[0] === 0x50 && u8[1] === 0x4b) return "zip";          // PK..  (WCC bundle / any zip)
    var m = s4(u8);
    if (m === "OCTM") return "ctm";                              // OpenCTM mesh
    if (m === "glTF") return "glb";                              // binary glTF
    if (m === "DRAC") return "draco";                            // Draco-compressed mesh
    if (m.toLowerCase().slice(0, 3) === "ply") return "ply";
    if (m.toLowerCase() === "soli") return "stl";               // "solid" ascii STL
    return null;
  }
  function isZip(u8) { return u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b; }
  function looksLikeWCC(url, u8) {
    if (!isZip(u8)) return false;
    if (/treatment_plan_video_wcc|wcc|\.zip(\?|$)/i.test(url)) return true;
    return u8.length > 200000;
  }

  // worth cloning the body? skip obvious html/js/css/json/images to stay light.
  function worthInspecting(url, ct, len) {
    if (/text\/html|javascript|text\/css|^image\/|font|^text\/plain|application\/wasm/i.test(ct)) return false;
    if (/\.(js|css|html?|png|jpe?g|gif|svg|woff2?|ttf|map|wasm)(\?|$)/i.test(url)) return false;
    if (len && len > MAX_BYTES) return false;                   // never clone giant bodies
    if (/octet-stream|zip|model\/|application\/x|ctm|gltf|glb|draco|mesh|binary/i.test(ct)) return true;
    if (/wcc|ctm|gltf|glb|drc|\.ply|\.stl|\.obj|mesh|model|scan|gingiv|gum/i.test(url)) return true;
    if (len && len > 60000) return true;                        // large unknown binary -> peek
    return false;
  }

  // Post to our isolated content script, scoped to THIS page's origin so a cross-origin
  // parent/embedder can never receive the scan bytes. (content.js runs same-origin.)
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  // announce our token to content.js first thing (before any page app code runs)
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}
  function postWCC(url, ab) {
    try { window.postMessage({ source: TAG, kind: "wcc", token: TOKEN, url: String(url || ""), size: ab.byteLength, bytes: ab }, ORIGIN); } catch (e) {}
  }
  function postResource(url, ct, ab, kind) {
    try {
      window.postMessage({
        source: TAG, kind: "resource", token: TOKEN, url: String(url || ""), ct: String(ct || ""),
        size: ab.byteLength, fmt: kind,
        // keep bytes for recognized meshes/archives so we can inspect them; metadata-only otherwise
        bytes: kind ? ab : null
      }, ORIGIN);
    } catch (e) {}
  }

  // central inspector: called with the response bytes for anything worth a look
  function inspect(url, ct, ab) {
    try {
      if (!ab || ab.byteLength > MAX_BYTES) return;   // never buffer/forward an oversized body
      var u8 = new Uint8Array(ab);
      if (looksLikeWCC(url, u8)) postWCC(url, ab.slice(0));
      var kind = meshKind(u8);
      // record every inspected response (kind=null => metadata only, so we still see "what loaded")
      postResource(url, ct, ab.slice(0), kind);
    } catch (e) {}
  }

  // ---- fetch ----
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function () {
      var args = arguments, reqUrl = "";
      try { reqUrl = (args[0] && args[0].url) ? args[0].url : String(args[0]); } catch (e) {}
      return _fetch.apply(this, args).then(function (res) {
        try {
          var url = reqUrl || res.url || "";
          var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
          var len = (res.headers && res.headers.get && +res.headers.get("content-length")) || 0;
          if (worthInspecting(url, ct, len)) {
            res.clone().arrayBuffer().then(function (ab) { inspect(url, ct, ab); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
  }

  // ---- XMLHttpRequest ----
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__wccUrl = url; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    this.addEventListener("load", function () {
      try {
        var url = xhr.__wccUrl || "";
        var ct = (xhr.getResponseHeader && xhr.getResponseHeader("content-type")) || "";
        var worth = worthInspecting(url, ct, 0);
        // not obviously a mesh: peek only the first bytes (no copy) and inspect just if they are
        // a known mesh/archive magic. Heavy images/blobs are no longer cloned "just in case".
        if (xhr.response instanceof ArrayBuffer) {
          var ab = xhr.response;
          if (ab.byteLength > MAX_BYTES) return;
          if (worth || meshKind(new Uint8Array(ab, 0, Math.min(8, ab.byteLength)))) inspect(url, ct, ab);
          return;
        }
        if (xhr.responseType === "blob" && xhr.response) {
          var blob = xhr.response;
          if (blob.size > MAX_BYTES) return;
          if (worth) { blob.arrayBuffer().then(function (b) { inspect(url, ct, b); }).catch(function () {}); return; }
          blob.slice(0, 8).arrayBuffer().then(function (head) {
            if (meshKind(new Uint8Array(head))) return blob.arrayBuffer().then(function (b) { inspect(url, ct, b); });
          }).catch(function () {});
          return;
        }
        if (!worth && xhr.responseType !== "" && xhr.responseType !== "text") return;
        if (xhr.responseType === "" || xhr.responseType === "text") {
          var s = xhr.responseText || "";
          if (s && (s.charCodeAt(0) === 0x50 && s.charCodeAt(1) === 0x4b)) {
            var u = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
            inspect(url, ct, u.buffer);
          }
        }
      } catch (e) {}
    });
    return _send.apply(this, arguments);
  };
})();



/* ===================== src/webgl_capture.js ===================== */
/*
 * webgl_capture.js — MAIN-world WebGL geometry ripper (experimental, document_start).
 *
 * The ClinCheck WASM engine GENERATES the gum at runtime and hands the finished vertices to
 * WebGL to draw. We can't read the WASM, but we CAN intercept that GPU-upload boundary: hook
 * getContext + the GL buffer/draw calls, and reconstruct every distinct mesh the engine draws
 * (positions + indices), plus a diagnostic manifest (attribute layouts, index type, candidate
 * color uniforms, VAO usage, coordinate ranges).
 *
 * This is step 1 — a DUMP of everything drawn — so we can identify which draw is the gum and
 * learn the engine's coordinate space. Nothing leaves the device; results go (token-authed) to
 * our isolated content script, which packages them into a downloadable GLB + manifest.
 *
 * Known v1 limits: best-effort for FLOAT positions (also HALF_FLOAT / normalized SHORT); tracks
 * attrib state globally + per-VAO when bindVertexArray is used; positions assumed to be the
 * lowest-location enabled FLOAT vec3/vec4 attribute (the manifest lists all so we can correct).
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckGLInstalled) return;
  window.__clincheckGLInstalled = true;

  // own per-load token, announced to content.js at document_start (before page code runs)
  var TOKEN = (function () {
    try { var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join(""); }
    catch (e) { return "g" + (Math.random ? Math.random().toString(36).slice(2) : "x"); }
  })();
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}
  var MAX_DRAWS = 4000;        // distinct draw signatures to remember
  var MAX_BUF = 64 * 1024 * 1024;
  var MAX_SNAP_TOTAL = 192 * 1024 * 1024;  // total bytes of draw-time snapshots kept per context

  // ---- GL constant byte sizes ----
  function compBytes(type) {
    switch (type) {
      case 0x1400: case 0x1401: return 1; // BYTE / UNSIGNED_BYTE
      case 0x1402: case 0x1403: return 2; // SHORT / UNSIGNED_SHORT
      case 0x1404: case 0x1405: return 4; // INT / UNSIGNED_INT
      case 0x140B: return 2;              // HALF_FLOAT
      case 0x1406: return 4;              // FLOAT
      default: return 4;
    }
  }
  function halfToFloat(h) {
    var s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 0x1F) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  var contexts = [];
  // Epochs let a caller ask "what was drawn since X": gl-mark bumps EPOCH, every draw (new or a
  // repeat of a known one) stamps its record with the current EPOCH, and a snapshot can be limited
  // to draws stamped at or after a given epoch. Used to rip exactly one aligner step's gums.
  var EPOCH = 0;

  function instrument(gl, kind) {
    var S = {
      kind: kind, gl: gl,
      buffers: new Map(),                 // WebGLBuffer -> Uint8Array (last uploaded bytes)
      boundArray: null, boundElement: null,
      program: null,
      vaos: new Map(),                    // vao -> { attribs:{loc:layout}, element:buffer }
      curVAO: null,
      globalAttribs: {}, globalElement: null,
      draws: [], seen: {}, drawBySig: {},
      colorByProgram: new Map(),          // program -> last vec4-ish uniform seen (color guess)
      snapCache: new Map(), snapBytes: 0, // fingerprint -> shared byte copy; total kept bytes
      fps: new Map(),                     // WebGLBuffer -> content hash of its current bytes
      overBudget: false                   // a draw was dropped because MAX_SNAP_TOTAL was hit
    };
    contexts.push(S);

    function attribTable() { return S.curVAO ? (S.vaos.get(S.curVAO) || setVAO(S.curVAO)).attribs : S.globalAttribs; }
    function setVAO(v) { if (!S.vaos.has(v)) S.vaos.set(v, { attribs: {}, element: null }); return S.vaos.get(v); }
    function elementBuf() { return S.curVAO ? (S.vaos.get(S.curVAO) || setVAO(S.curVAO)).element : S.globalElement; }

    function wrap(name, fn) { var orig = gl[name]; if (typeof orig !== "function") return; gl[name] = function () { try { fn.apply(null, arguments); } catch (e) {} return orig.apply(gl, arguments); }; }

    wrap("bindBuffer", function (target, buffer) {
      if (target === gl.ARRAY_BUFFER) S.boundArray = buffer;
      else if (target === gl.ELEMENT_ARRAY_BUFFER) {
        S.boundElement = buffer;
        if (S.curVAO) setVAO(S.curVAO).element = buffer; else S.globalElement = buffer;
      }
    });
    wrap("bufferData", function (target, data) {
      var buf = (target === gl.ELEMENT_ARRAY_BUFFER) ? S.boundElement : S.boundArray;
      if (!buf || typeof data === "number") return;            // sized-only alloc, no data
      // always COPY: a bare ArrayBuffer is often a scratch buffer the viewer reuses for the next mesh
      var bytes = data.buffer ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : new Uint8Array(data.slice(0));
      S.fps.delete(buf);
      if (bytes.byteLength <= MAX_BUF) S.buffers.set(buf, bytes); else S.buffers.delete(buf);
    });
    wrap("bufferSubData", function (target, offset, data) {
      var buf = (target === gl.ELEMENT_ARRAY_BUFFER) ? S.boundElement : S.boundArray;
      if (!buf || !data || typeof data === "number") return;
      var bytes = data.buffer ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : new Uint8Array(data);
      var cur = S.buffers.get(buf);
      if (!cur || cur.byteLength < offset + bytes.byteLength) { var nb = new Uint8Array(Math.max(offset + bytes.byteLength, cur ? cur.byteLength : 0)); if (cur) nb.set(cur); cur = nb; }
      cur.set(bytes, offset); S.buffers.set(buf, cur); S.fps.delete(buf);
    });
    wrap("vertexAttribPointer", function (loc, size, type, normalized, stride, offset) {
      attribTable()[loc] = { buffer: S.boundArray, size: size, type: type, normalized: !!normalized, stride: stride, offset: offset, enabled: true };
    });
    if (gl.vertexAttribIPointer) wrap("vertexAttribIPointer", function (loc, size, type, stride, offset) {
      attribTable()[loc] = { buffer: S.boundArray, size: size, type: type, normalized: false, stride: stride, offset: offset, enabled: true, integer: true };
    });
    wrap("enableVertexAttribArray", function (loc) { var a = attribTable()[loc]; if (a) a.enabled = true; });
    wrap("disableVertexAttribArray", function (loc) { var a = attribTable()[loc]; if (a) a.enabled = false; });
    wrap("useProgram", function (p) { S.program = p; });
    if (gl.bindVertexArray) wrap("bindVertexArray", function (v) { S.curVAO = v; });
    // crude color guess: remember vec4 uniforms (likely material/base color)
    ["uniform4f", "uniform4fv"].forEach(function (n) {
      if (!gl[n]) return;
      wrap(n, function (loc, a, b, c, d) {
        var col = (n === "uniform4f") ? [a, b, c, d] : (a && a.length >= 4 ? [a[0], a[1], a[2], a[3]] : null);
        if (col && S.program) S.colorByProgram.set(S.program, col);
      });
    });

    function progId(p) { if (!p.__cid) p.__cid = "prog" + (++progId._n); return p.__cid; }
    progId._n = 0;

    // Content fingerprint: byte length + two FNV-1a hashes over EVERY byte. Two draws with
    // identical LAYOUT but different geometry (upper vs lower gum share one template; a new
    // stage's gum differs from the last by a few hundred vertices) always get distinct
    // fingerprints. Sampling missed small contiguous changes, so this hashes everything, but
    // only once per upload: the result is cached per buffer until bufferData/bufferSubData.
    function fingerprint(bytes) {
      var n = bytes.byteLength, h1 = 0x811c9dc5, h2 = 0x01000193 ^ n;
      for (var i = 0; i < n; i++) {
        var b = bytes[i];
        h1 = Math.imul(h1 ^ b, 0x01000193);
        h2 = Math.imul(h2 ^ b, 0x85ebca6b) ^ (h2 >>> 13);
      }
      return n + ":" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    }
    function fpFor(buf, bytes) {
      var f = S.fps.get(buf);
      if (f == null) { f = fingerprint(bytes); S.fps.set(buf, f); }
      return f;
    }

    function record(mode, count, indexType, indexOffset, drawType) {
      if (S.draws.length >= MAX_DRAWS) return;
      var attribs = attribTable();
      var locs = Object.keys(attribs).filter(function (l) { return attribs[l].enabled && attribs[l].buffer; });
      if (!locs.length) return;
      var attribList = locs.map(function (l) { var a = attribs[l]; return { loc: +l, size: a.size, type: a.type, stride: a.stride, offset: a.offset, normalized: a.normalized, buffer: a.buffer, integer: !!a.integer }; });
      // pick the position attribute up front so we can fingerprint + snapshot its bytes NOW
      var pos = pickPosition(attribList);
      var posBytes = pos && pos.buffer ? S.buffers.get(pos.buffer) : null;
      if (!posBytes) return;                                   // nothing uploaded yet — skip
      var elemBuf = (drawType === "elements") ? elementBuf() : null;
      var elemBytes = elemBuf ? S.buffers.get(elemBuf) : null;
      // layout signature + content fingerprint => dedupe identical geometry across frames,
      // while keeping distinct geometry that happens to share a layout.
      var vfp = fpFor(pos.buffer, posBytes);
      var sig = drawType + "|" + (S.program ? progId(S.program) : "-") + "|" + mode + "|" + count + "|" + locs.map(function (l) { var a = attribs[l]; return l + ":" + a.size + ":" + a.type + ":" + a.stride + ":" + a.offset; }).join(",") + "|" + indexType + ":" + indexOffset + "|fp:" + vfp;
      var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      if (S.seen[sig]) { var known = S.drawBySig[sig]; if (known) { known.epoch = EPOCH; known.t = now; } return; }
      // snapshot the referenced bytes AT DRAW TIME so a later overwrite can't corrupt them.
      // Copies are shared via a content-fingerprint cache (many draws reference the same upload,
      // e.g. one interleaved buffer per model) and bounded by MAX_SNAP_TOTAL so stage-scrubbing /
      // animation can't grow memory without limit.
      function snap(bytes, key) {
        var c = S.snapCache.get(key);
        if (c) return c;
        if (S.snapBytes + bytes.byteLength > MAX_SNAP_TOTAL) return null;
        c = new Uint8Array(bytes); S.snapBytes += c.byteLength; S.snapCache.set(key, c);
        return c;
      }
      var vcopy = snap(posBytes, "v:" + posBytes.byteLength + ":" + vfp);
      var icopy = elemBytes ? snap(elemBytes, "i:" + fpFor(elemBuf, elemBytes)) : null;
      // over budget: keep what we have, and say so. The signature is NOT burned, so the draw is
      // retried (and can still be kept) if budget frees up; nothing is silently marked "seen".
      if (!vcopy || (elemBytes && !icopy)) { S.overBudget = true; return; }
      S.seen[sig] = true;
      var rec = {
        epoch: EPOCH, t: now,                                  // t = last time this draw was seen (latest-frame filter)
        mode: mode, count: count, drawType: drawType, indexType: indexType, indexOffset: indexOffset,
        program: S.program ? progId(S.program) : null,
        color: S.program ? (S.colorByProgram.get(S.program) || null) : null,
        attribs: attribList,
        posBuffer: pos.buffer,
        vbytes: vcopy,                                         // shared snapshot (read-only)
        ibytes: icopy,
        element: elemBuf
      };
      S.draws.push(rec); S.drawBySig[sig] = rec;
    }
    wrap("drawElements", function (mode, count, type, offset) { record(mode, count, type, offset, "elements"); });
    wrap("drawArrays", function (mode, first, count) { record(mode, count, 0, first, "arrays"); });
    if (gl.drawElementsInstanced) wrap("drawElementsInstanced", function (mode, count, type, offset) { record(mode, count, type, offset, "elements"); });
    if (gl.drawArraysInstanced) wrap("drawArraysInstanced", function (mode, first, count) { record(mode, count, 0, first, "arrays"); });
    if (gl.drawRangeElements) wrap("drawRangeElements", function (mode, start, end, count, type, offset) { record(mode, count, type, offset, "elements"); });
    // ANGLE_instanced_arrays (WebGL1) lives on an extension object, not the context
    var _ext = gl.getExtension;
    if (typeof _ext === "function") gl.getExtension = function (name) {
      var ext = _ext.apply(gl, arguments);
      try {
        if (ext && name === "ANGLE_instanced_arrays" && !ext.__clincheckHooked) {
          ext.__clincheckHooked = true;
          var de = ext.drawElementsInstancedANGLE, da = ext.drawArraysInstancedANGLE;
          if (de) ext.drawElementsInstancedANGLE = function (mode, count, type, offset) { try { record(mode, count, type, offset, "elements"); } catch (e) {} return de.apply(ext, arguments); };
          if (da) ext.drawArraysInstancedANGLE = function (mode, first, count) { try { record(mode, count, 0, first, "arrays"); } catch (e) {} return da.apply(ext, arguments); };
        }
      } catch (e) {}
      return ext;
    };
  }

  // ---- decode a recorded draw into positions + indices ----
  function readScalar(dv, off, type, normalized) {
    switch (type) {
      case 0x1406: return dv.getFloat32(off, true);
      case 0x140B: return halfToFloat(dv.getUint16(off, true));
      case 0x1401: { var u = dv.getUint8(off); return normalized ? u / 255 : u; }
      case 0x1400: { var b = dv.getInt8(off); return normalized ? Math.max(b / 127, -1) : b; }
      case 0x1403: { var us = dv.getUint16(off, true); return normalized ? us / 65535 : us; }
      case 0x1402: { var sh = dv.getInt16(off, true); return normalized ? Math.max(sh / 32767, -1) : sh; }
      case 0x1405: return dv.getUint32(off, true);
      case 0x1404: return dv.getInt32(off, true);
      default: return dv.getFloat32(off, true);
    }
  }
  function pickPosition(attribs) {
    // prefer enabled FLOAT/HALF vec3 (then vec4), lowest location
    var cand = attribs.filter(function (a) { return (a.size === 3 || a.size === 4) && (a.type === 0x1406 || a.type === 0x140B); });
    cand.sort(function (x, y) { return (x.size - y.size) || (x.loc - y.loc); });
    return cand[0] || attribs.slice().sort(function (x, y) { return x.loc - y.loc; })[0];
  }
  function decodeDraw(S, d, idx) {
    var pos = pickPosition(d.attribs);
    if (!pos) return null;
    var vbytes = d.vbytes; if (!vbytes) return null;           // bytes snapshotted at draw time
    var vdv = new DataView(vbytes.buffer, vbytes.byteOffset, vbytes.byteLength);
    var cb = compBytes(pos.type), stride = pos.stride || pos.size * cb;
    var nMax = Math.floor((vbytes.byteLength - pos.offset) / stride);
    if (nMax <= 0) return null;

    var indices = null;
    if (d.drawType === "elements" && d.element) {
      var ibytes = d.ibytes; if (!ibytes) return null;
      var idv = new DataView(ibytes.buffer, ibytes.byteOffset, ibytes.byteLength);
      var isz = compBytes(d.indexType), get = (d.indexType === 0x1405) ? "getUint32" : (d.indexType === 0x1401 ? "getUint8" : "getUint16");
      if (d.indexOffset < 0 || d.indexOffset + d.count * isz > ibytes.byteLength) return null;   // indices past the upload
      indices = new Uint32Array(d.count);
      for (var i = 0; i < d.count; i++) indices[i] = idv[get](d.indexOffset + i * isz, true);
    }
    // bound vertex count to what's referenced; a draw that references vertices we don't have
    // would export NaN/garbage faces, so drop it instead of clamping
    var nVerts = nMax;
    if (indices) { var mx = 0; for (var k = 0; k < indices.length; k++) if (indices[k] > mx) mx = indices[k]; if (mx + 1 > nMax) return null; nVerts = mx + 1; }
    else { if (d.indexOffset + d.count > nMax) return null; nVerts = d.indexOffset + d.count; }
    if (nVerts > 4000000) return null;

    var positions = new Float32Array(nVerts * 3);
    for (var v = 0; v < nVerts; v++) {
      var base = pos.offset + v * stride;
      positions[3 * v] = readScalar(vdv, base, pos.type, pos.normalized);
      positions[3 * v + 1] = readScalar(vdv, base + cb, pos.type, pos.normalized);
      positions[3 * v + 2] = pos.size >= 3 ? readScalar(vdv, base + 2 * cb, pos.type, pos.normalized) : 0;
    }
    if (!indices) {                      // drawArrays: sequential
      indices = new Uint32Array(d.count);
      for (var a = 0; a < d.count; a++) indices[a] = d.indexOffset + a;
    }
    // bbox + center for the manifest
    var mn = [Infinity, Infinity, Infinity], mx2 = [-Infinity, -Infinity, -Infinity];
    for (var p = 0; p < positions.length; p += 3) for (var c = 0; c < 3; c++) { var val = positions[p + c]; if (val < mn[c]) mn[c] = val; if (val > mx2[c]) mx2[c] = val; }
    return {
      name: "draw" + idx + (d.program ? "_" + d.program : ""),
      positions: positions, indices: indices,
      meta: { drawType: d.drawType, mode: d.mode, glMode: d.mode, vertCount: nVerts, indexCount: indices.length,
        program: d.program, color: d.color, posType: pos.type, posSize: pos.size, stride: stride,
        bboxMin: mn.map(r), bboxMax: mx2.map(r), attribLocs: d.attribs.map(function (a) { return a.loc + ":sz" + a.size + ":ty" + a.type.toString(16); }) }
    };
  }
  function r(x) { return Math.round(x * 1000) / 1000; }

  // latestFrame: only the draws of the most recent frame (everything seen within 150 ms of the newest
  // draw), i.e. what is on screen now rather than every variant drawn this session
  function snapshot(sinceEpoch, latestFrame) {
    var out = [], cutoff = -Infinity;
    if (latestFrame) {
      var newest = -Infinity;
      for (var c0 = 0; c0 < contexts.length; c0++) for (var j = 0; j < contexts[c0].draws.length; j++) if (contexts[c0].draws[j].t > newest) newest = contexts[c0].draws[j].t;
      cutoff = newest - 150;
    }
    for (var c = 0; c < contexts.length; c++) {
      var S = contexts[c];
      for (var i = 0; i < S.draws.length; i++) {
        if (sinceEpoch != null && !(S.draws[i].epoch >= sinceEpoch)) continue;
        if (latestFrame && !(S.draws[i].t >= cutoff)) continue;
        // one malformed draw must not wipe every other mesh (and with it the gums)
        var m = null;
        try { m = decodeDraw(S, S.draws[i], i); } catch (e) { m = null; }
        if (m && m.positions.length) out.push(m);
      }
    }
    return out;
  }

  // ---- bridge: respond to a snapshot request from content.js ----
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== TAG) return;
    if (d.kind === "gl-mark") {
      EPOCH++;
      try { window.postMessage({ source: TAG, kind: "gl-mark-ack", token: TOKEN, reqId: d.reqId, epoch: EPOCH }, ORIGIN); } catch (e) {}
      return;
    }
    if (d.kind === "gl-stats-request") {
      // cheap: how many distinct draws were seen since an epoch (no geometry transferred)
      var n = 0;
      for (var ci = 0; ci < contexts.length; ci++) for (var di = 0; di < contexts[ci].draws.length; di++) if (contexts[ci].draws[di].epoch >= d.sinceEpoch) n++;
      try { window.postMessage({ source: TAG, kind: "gl-stats", token: TOKEN, reqId: d.reqId, recent: n }, ORIGIN); } catch (e) {}
      return;
    }
    if (d.kind !== "gl-snapshot-request") return;
    var reqId = d.reqId == null ? null : d.reqId;
    var meshes = [];
    try { meshes = snapshot(typeof d.sinceEpoch === "number" ? d.sinceEpoch : null, !!d.latestFrame); } catch (e) {}
    // send light payloads (transfer the buffers)
    var payload = meshes.map(function (m) { return { name: m.name, positions: m.positions, indices: m.indices, meta: m.meta }; });
    try {
      window.postMessage({ source: TAG, kind: "gl-snapshot", token: TOKEN, reqId: reqId, count: payload.length, meshes: payload,
        summary: { contexts: contexts.length, kinds: contexts.map(function (s) { return s.kind; }), totalDraws: contexts.reduce(function (a, s) { return a + s.draws.length; }, 0),
          budgetExceeded: contexts.some(function (s) { return s.overBudget; }) } }, ORIGIN);
    } catch (e) {
      // if structured clone is too big, send just the manifest
      try { window.postMessage({ source: TAG, kind: "gl-snapshot", token: TOKEN, reqId: reqId, count: payload.length, meshes: [], error: "payload too large: " + String(e && e.message || e), manifestOnly: payload.map(function (m) { return m.meta; }) }, ORIGIN); } catch (e2) {}
    }
  });

  // ---- hook context creation ----
  var _get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var ctx = _get.apply(this, arguments);
    try {
      if (ctx && !ctx.__clincheckHooked && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
        ctx.__clincheckHooked = true; instrument(ctx, type);
      }
    } catch (e) {}
    return ctx;
  };
  if (window.OffscreenCanvas && OffscreenCanvas.prototype.getContext) {
    var _oget = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type) {
      var ctx = _oget.apply(this, arguments);
      try { if (ctx && !ctx.__clincheckHooked && /webgl/.test(type)) { ctx.__clincheckHooked = true; instrument(ctx, type + "(offscreen)"); } } catch (e) {}
      return ctx;
    };
  }
})();



/* ===================== src/viewer_bridge.js ===================== */
/*
 * viewer_bridge.js — MAIN-world bridge to the ClinCheck viewer's own state (document_start).
 *
 * The viewer page exposes its 3D editor as `window.editor` with getViewState()/setViewState().
 * Its view state carries the REAL aligner stage: stage.currentStage, stage.firstStage,
 * stage.lastStage. That beats reading the DOM label, which is off by one ("Aligner Number 1"
 * at currentStage 0) and does not follow programmatic changes. The plan length comes from
 * firstStage..lastStage, so nothing assumes a step count.
 *
 * Protocol (same TAG + per-load token handshake as capture.js / webgl_capture.js):
 *   in : { kind:"viewer-request", op:"info" | "setStage", stage, reqId }
 *   out: { kind:"viewer-reply", reqId, token, ok, info:{currentStage, firstStage, lastStage}, error }
 *   out: { kind:"viewer-stage", token, info }  pushed whenever the current stage changes
 * Nothing leaves the device.
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckViewerBridge) return;
  window.__clincheckViewerBridge = true;

  var TOKEN = (function () {
    try { var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join(""); }
    catch (e) { return "v" + (Math.random ? Math.random().toString(36).slice(2) : "x"); }
  })();
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}

  function post(msg) { msg.source = TAG; msg.token = TOKEN; try { window.postMessage(msg, ORIGIN); } catch (e) {} }

  function editor() {
    var ed = window.editor;
    return (ed && typeof ed.getViewState === "function" && typeof ed.setViewState === "function") ? ed : null;
  }
  function readInfo() {
    var ed = editor(); if (!ed) return null;
    var st;
    try { var vs = ed.getViewState(); st = vs && vs.stage; } catch (e) { return null; }
    if (!st || typeof st.currentStage !== "number" || typeof st.lastStage !== "number") return null;
    return {
      currentStage: st.currentStage,
      firstStage: typeof st.firstStage === "number" ? st.firstStage : 0,
      lastStage: st.lastStage
    };
  }
  function setStage(n) {
    var ed = editor(); if (!ed) return Promise.reject(new Error("viewer controls not found"));
    var vs = ed.getViewState(), st = vs && vs.stage;
    if (!st) return Promise.reject(new Error("viewer has no stage state"));
    n = Math.max(st.firstStage || 0, Math.min(st.lastStage, n | 0));
    var next = {}; for (var k in vs) next[k] = vs[k];
    var ns = {}; for (var j in st) ns[j] = st[j];
    ns.currentStage = n; next.stage = ns;
    return Promise.resolve(ed.setViewState(next));
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== TAG || d.kind !== "viewer-request") return;
    var reqId = d.reqId;
    if (d.op === "info") {
      var info = readInfo();
      post({ kind: "viewer-reply", reqId: reqId, ok: !!info, info: info, error: info ? null : "viewer controls not found" });
    } else if (d.op === "setStage") {
      setStage(d.stage).then(function () {
        post({ kind: "viewer-reply", reqId: reqId, ok: true, info: readInfo() });
      }, function (e) {
        post({ kind: "viewer-reply", reqId: reqId, ok: false, info: readInfo(), error: String(e && e.message || e) });
      });
    }
  });

  // push stage changes (user drags the slider, plays, or we step it) so the badge stays exact
  var last = null;
  setInterval(function () {
    var info = readInfo(); if (!info) return;
    var key = info.currentStage + ":" + info.firstStage + ":" + info.lastStage;
    if (key !== last) { last = key; post({ kind: "viewer-stage", info: info }); }
  }, 500);
})();



/* ===================== src/all_stages.js ===================== */
/*
 * all_stages.js — export EVERY aligner stage with its REAL gums, one folder per stage.
 *
 * The viewer generates a different gum for each step and only draws the step on screen, so each
 * step's gum has to be ripped while that step is shown. This drives the viewer through its own
 * stage range (viewer_bridge.js: firstStage..lastStage, however long the plan is):
 *   mark the ripper (gl-mark) -> set the stage -> wait until drawing settles (gl-stats)
 *   -> snapshot only what was drawn since the mark -> register gums on that stage's teeth
 *   -> lay the files out (engine.layoutStage) -> stream them into the zip -> next stage.
 * The zip is built with fflate's streaming Zip, so each stage is compressed and dropped as it goes
 * (a long plan never holds every stage's raw STLs at once). The viewer is put back on the stage
 * the user was on.
 *
 * Shared by content.js (extension, ISOLATED world) and userscript_orchestrator.js (one context).
 * Exposes globalThis.TeethAllStages(opts) -> Promise<{ chunks, stageCount, firstStage, lastStage,
 *   steps:[{stage, arches}], missing:[stage], restored }>
 *   opts: { tag, origin, tokens, engine, fflate, bytes, onProgress({done,total,stage}) }
 */
(function (root) {
  "use strict";

  var MAX_ZIP = 2 * 1024 * 1024 * 1024;    // refuse to build more than 2 GB of compressed output

  function TeethAllStages(opts) {
    var TAG = opts.tag, ORIGIN = opts.origin, tokens = opts.tokens, engine = opts.engine, ff = opts.fflate;
    var onProgress = opts.onProgress || function () {};
    var isCancelled = opts.isCancelled || function () { return false; };
    var seq = 0;

    function sleep(ms) { return new Promise(function (r) { root.setTimeout(r, ms); }); }

    // one request/reply round trip over postMessage, matched by reqId and an announced token
    function request(msg, replyKind, timeoutMs) {
      return new Promise(function (resolve) {
        var id = "all-" + Date.now().toString(36) + "-" + (++seq), done = false;
        function finish(v) { if (done) return; done = true; root.removeEventListener("message", onMsg); resolve(v); }
        function onMsg(ev) {
          if (ev.source !== root) return;
          var d = ev.data;
          if (!d || d.source !== TAG || d.kind !== replyKind || d.reqId !== id) return;
          if (!d.token || !tokens[d.token]) return;
          finish(d);
        }
        root.addEventListener("message", onMsg);
        msg.source = TAG; msg.reqId = id;
        try { root.postMessage(msg, ORIGIN); } catch (e) {}
        root.setTimeout(function () { finish(null); }, timeoutMs);
      });
    }
    function viewer(op, stage) { return request({ kind: "viewer-request", op: op, stage: stage }, "viewer-reply", 6000); }

    // wait until the set of draws seen since `epoch` stops growing (the new gum is drawn a frame
    // or two after the stage change). Returns the count seen.
    async function settle(epoch) {
      var t0 = Date.now(), lastN = -1, same = 0, n = 0;
      await sleep(350);
      while (Date.now() - t0 < 7000) {
        var st = await request({ kind: "gl-stats-request", sinceEpoch: epoch }, "gl-stats", 1500);
        n = st ? st.recent : 0;
        if (n > 0 && n === lastN) { if (++same >= 2 && Date.now() - t0 >= 800) return n; }
        else same = 0;
        lastN = n;
        await sleep(250);
      }
      return n;
    }

    async function ripStage(s) {
      var mk = await request({ kind: "gl-mark" }, "gl-mark-ack", 2000);
      if (!mk) throw new Error("the 3D capture is not responding; reload the viewer page");
      var r = await viewer("setStage", s);
      if (!r || !r.ok) throw new Error("could not move the viewer to stage " + s + (r && r.error ? ": " + r.error : ""));
      var n = await settle(mk.epoch);
      if (!n) return [];
      var snap = await request({ kind: "gl-snapshot-request", sinceEpoch: mk.epoch }, "gl-snapshot", 15000);
      return (snap && snap.meshes) || [];
    }

    return (async function () {
      var info = await viewer("info");
      if (!info || !info.ok || !info.info) throw new Error("can't reach the viewer's step controls on this page");
      // Match the viewer's "Aligner Number N / T" slider one to one. Verified live 2026-10-19:
      // aligner N = stage firstStage + N - 1, T = lastStage, and the slider stops at stage lastStage - 1
      // (the final stage in the data is never shown). So export aligners 1..T, named by aligner number.
      var first = info.info.firstStage, last = info.info.lastStage, original = info.info.currentStage;
      var total = Math.max(1, last - first);                 // aligner count = the slider's "/ T"
      var lastShown = first + total - 1;

      var chunks = [], zipBytes = 0, zipErr = null;
      var zip = new ff.Zip(function (err, data) {
        if (err) { zipErr = err; return; }
        chunks.push(data); zipBytes += data.byteLength;
      });
      function addFile(path, bytes) {
        if (zipErr) throw zipErr;
        var f = new ff.ZipDeflate(path, { level: 6 });
        zip.add(f); f.push(bytes, true);
        if (zipBytes > MAX_ZIP) throw new Error("export too large");
      }

      var steps = [], missing = [], manifest = null, restored = false;
      try {
        // the viewer only redraws on a change: if it already shows the first stage, step away first
        if (original === first && lastShown > first) await viewer("setStage", first + 1);
        for (var s = first; s <= lastShown; s++) {
          var aligner = s - first + 1;
          if (isCancelled()) throw new Error("Export cancelled.");
          onProgress({ done: aligner - 1, total: total, stage: s, aligner: aligner });
          var meshes = await ripStage(s);
          var res = engine.exportFromBundle(opts.bytes, { stage: s, glb: true, glMeshes: meshes });
          var arches = ((res.gumInfo && res.gumInfo.gums) || []).map(function (g) { return g.arch; });
          if (arches.length < 2) missing.push(aligner);
          steps.push({ aligner: aligner, stage: s, arches: arches });
          if (!manifest) manifest = res.manifest;
          var laid = engine.layoutStage(res.outputs, engine.stageDirName(aligner, total));
          for (var path in laid) addFile(path, laid[path]);
          res = null; laid = null; meshes = null;     // let this stage's raw files go
        }
        onProgress({ done: total, total: total, stage: lastShown, aligner: total });
      } finally {
        try { var back = await viewer("setStage", original); restored = !!(back && back.ok); } catch (e) {}
      }

      var readme = [
        "Teeth Exporter (unofficial)",
        "Every aligner with its real gums: " + total + " stages, numbered like the viewer's \"Aligner Number\" slider.",
        "stage_01 = Aligner Number 1 (start of the plan) ... stage_" + String(total).padStart(2, "0") + " = Aligner Number " + total + ".",
        "units: millimeters, true scale", "",
        "One folder per stage. In each stage folder:",
        "  full_mouth_with_gums.stl   both arches, teeth + real gums",
        "  upper_with_gums.stl        upper teeth + gum",
        "  lower_with_gums.stl        lower teeth + gum",
        "  full_mouth.glb             colored, separate meshes, opens in any 3D viewer",
        "  Advanced/                  teeth only, gums only, and per-arch versions of each", "",
        missing.length
          ? "Gum not captured for aligner(s) " + missing.join(", ") + ": those folders use teeth-only files at the top for the missing arch."
          : "Both gums captured for every aligner.",
        "",
        "manifest.json              per-tooth arch / UNS number / width (mm)",
        "Teeth are an exact extraction. Gums are the viewer's own generated surface for each stage."
      ];
      addFile("README.txt", new TextEncoder().encode(readme.join("\n")));
      addFile("manifest.json", new TextEncoder().encode(JSON.stringify({ alignerCount: total, stages: steps, teeth: manifest }, null, 2)));
      zip.end();
      if (zipErr) throw zipErr;
      return { chunks: chunks, bytes: zipBytes, stageCount: total, firstStage: first, lastStage: last, steps: steps, missing: missing, restored: restored };
    })();
  }

  root.TeethAllStages = TeethAllStages;
})(typeof globalThis !== "undefined" ? globalThis : this);



/* ===================== src/controller.js ===================== */
/*
 * controller.js — everything the tool DOES, shared by both builds.
 *
 * The extension (content.js, ISOLATED world) and the userscript (userscript_orchestrator.js, one
 * page context) both create one controller, so a button behaves identically in either. It:
 *   - collects the token handshake, the WCC bundle, viewer stage pushes and WebGL snapshots from
 *     capture.js / webgl_capture.js / viewer_bridge.js (same-window postMessage, token-checked),
 *   - tracks the current aligner (viewer state first, DOM label probe as fallback),
 *   - runs the commands the panel offers: fullMouth, allStages, raw, diag, glCapture.
 * Everything stays in the tab; downloads are local blob links.
 *
 * Exposes globalThis.TeethController(hooks) -> { state, status(), run(name, args) -> Promise<result> }
 *   hooks.onCapture(state)      the scan arrived
 *   hooks.onStep(info)          current aligner changed: {aligner, total}
 *   hooks.onProgress(p)         every-aligner export progress: {aligner, total}
 *   hooks.onRunStart(name)      a command started
 *   hooks.onRunEnd(name, r)     a command finished with result r
 * cancel() stops an every-aligner export after the aligner in progress (the viewer is put back).
 */
(function (root) {
  "use strict";

  var TAG = "CLINCHECK_WCC_CAPTURE";
  var MAX_BYTES = 96 * 1024 * 1024;    // reject any single payload bigger than this
  var MAX_TOTAL = 160 * 1024 * 1024;   // total retained mesh bytes across the session
  var MAX_FILES = 64;                  // max distinct mesh payloads kept for diagnostics

  function TeethController(hooks) {
    hooks = hooks || {};
    var engine = root.ClinCheckEngine;
    var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
    function emit(name, arg) { try { if (hooks[name]) hooks[name](arg); } catch (e) {} }

    var state = {
      bytes: null, url: "", size: 0, capturedAt: 0,      // the WCC bundle
      resources: [], payloads: {}, seen: {}, keptBytes: 0, // diagnostics: every recorded response
      tokens: {},                                         // tokens announced by our MAIN-world scripts
      glReqId: 0, glPending: null,                        // WebGL snapshot round trip
      maxStage: null, currentStep: null, stepTotal: null, stepSource: null,
      busy: null, progress: null, cancelled: false        // command in flight + every-aligner progress
    };

    // ---- current aligner: the viewer's own state wins; the DOM label probe is the fallback ----
    var probe = null;
    function ensureProbe() {
      if (probe || !root.TeethStageProbe) return;
      probe = root.TeethStageProbe({
        getMaxStage: function () { return state.maxStage; },
        onChange: function (info) {
          if (state.stepSource === "viewer") return;
          state.currentStep = info.stage; state.stepTotal = info.total; state.stepSource = info.source;
          emit("onStep", { aligner: info.stage + 1, total: info.total });
        }
      });
      probe.start();
    }
    // which stage to export: the Advanced override (typed as the viewer's aligner number) wins
    function resolveStage(override) {
      if (override != null && override !== "") {
        var s = Math.max(0, (override | 0) - 1);
        return state.maxStage != null ? Math.min(state.maxStage, s) : s;
      }
      return state.currentStep != null ? state.currentStep : 0;
    }

    // ---- diagnostics helpers ----
    var MAGIC = {                                         // re-verify the claimed format from the bytes
      zip: function (u) { return u[0] === 0x50 && u[1] === 0x4b; },
      ctm: function (u) { return u[0] === 0x4f && u[1] === 0x43 && u[2] === 0x54 && u[3] === 0x4d; },
      glb: function (u) { return u[0] === 0x67 && u[1] === 0x6c && u[2] === 0x54 && u[3] === 0x46; },
      draco: function (u) { return u[0] === 0x44 && u[1] === 0x52 && u[2] === 0x41 && u[3] === 0x43; },
      ply: function (u) { return u[0] === 0x70 && u[1] === 0x6c && u[2] === 0x79; },
      stl: function (u) { return u[0] === 0x73 && u[1] === 0x6f && u[2] === 0x6c; }
    };
    // diagnostics get emailed around: origin + path only (no query string with signed tokens),
    // ID-like path segments (case / patient IDs) replaced, truncated
    function redactId(seg) { return /\d{5,}|[0-9a-f]{16,}|[0-9a-f-]{32,}/i.test(seg) ? ":id" : seg; }
    function safeUrl(url) {
      var s;
      try { var u = new URL(url, location.href); s = u.origin + u.pathname.split("/").map(redactId).join("/"); }
      catch (e) { s = String(url || "").split(/[?#]/)[0].split("/").map(redactId).join("/"); }
      return s.slice(0, 120);
    }
    function basename(url) {
      var b;
      try { var u = new URL(url, location.href); b = u.pathname.split("/").pop() || "resource"; }
      catch (e) { b = String(url).split(/[?#]/)[0].split("/").pop() || "resource"; }
      b = redactId(b); return (b === ":id" ? "resource" : b).slice(0, 60);
    }
    function uniqueName(name) {
      var n = name || "resource", i = 1;
      while (state.payloads[n]) { n = name.replace(/(\.[^.]*)?$/, "_" + (i++) + "$1"); }
      return n;
    }

    // ---- messages from our MAIN-world scripts ----
    root.addEventListener("message", function (ev) {
      if (ev.source !== root) return;
      if (ev.origin !== location.origin && ev.origin !== "null") return;
      var d = ev.data;
      if (!d || d.source !== TAG) return;
      if (d.kind === "hello") { if (typeof d.token === "string") state.tokens[d.token] = true; return; }
      if (!d.token || !state.tokens[d.token]) return;            // reject forged / pre-token messages

      if (d.kind === "gl-snapshot") {
        var p = state.glPending;
        if (!p || d.reqId !== p.id) return;                      // a late reply to an older request
        state.glPending = null;
        p.resolve({ meshes: Array.isArray(d.meshes) ? d.meshes : [], summary: d.summary || { error: d.error || null } });
        return;
      }
      if (d.kind === "viewer-stage" && d.info) {
        state.currentStep = d.info.currentStage; state.stepTotal = d.info.lastStage; state.stepSource = "viewer";
        if (state.busy !== "allStages") emit("onStep", { aligner: d.info.currentStage - d.info.firstStage + 1, total: d.info.lastStage });
        return;
      }
      if (d.kind === "wcc" && d.bytes) {
        if (d.bytes.byteLength > MAX_BYTES) return;
        var wb = new Uint8Array(d.bytes);
        if (!MAGIC.zip(wb)) return;                              // must really be a ZIP
        state.bytes = wb; state.url = d.url || ""; state.size = wb.length; state.capturedAt = Date.now();
        try { state.maxStage = engine.stageRange(wb).max; } catch (e) {}
        ensureProbe();
        emit("onCapture", state);
        return;
      }
      if (d.kind === "resource") {
        var key = (d.url || "") + "|" + d.size;
        if (state.seen[key]) return;
        state.seen[key] = true;
        var rec = { url: d.url || "", ct: d.ct || "", size: d.size || 0, fmt: d.fmt || null, file: null };
        if (d.bytes && d.fmt && d.bytes.byteLength <= MAX_BYTES &&
            Object.keys(state.payloads).length < MAX_FILES && state.keptBytes + d.bytes.byteLength <= MAX_TOTAL) {
          var u8 = new Uint8Array(d.bytes);
          if (MAGIC[d.fmt] && MAGIC[d.fmt](u8)) {
            var ext = { zip: ".zip", ctm: ".ctm", glb: ".glb", draco: ".drc", ply: ".ply", stl: ".stl" }[d.fmt] || "";
            var name = basename(d.url); if (ext && !name.toLowerCase().endsWith(ext)) name += ext;
            name = uniqueName(name);
            state.payloads[name] = u8; state.keptBytes += u8.length; rec.file = name;
          }
        }
        state.resources.push(rec);
      }
    });

    // ---- helpers ----
    function download(bytes, filename) {
      var blob = new Blob(Array.isArray(bytes) ? bytes : [bytes], { type: "application/zip" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename; a.style.display = "none";
      (document.body || document.documentElement).appendChild(a); a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);   // big zips need time to hand off
    }
    function ts() {
      var d = new Date(); function p(n) { return String(n).padStart(2, "0"); }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    }
    function text(s) { return new TextEncoder().encode(s); }
    // a fresh WebGL rip; each request gets a new id so a slow reply can't hand over an old stage's meshes
    function snapshot(latestFrame) {
      return new Promise(function (resolve) {
        var id = ++state.glReqId;
        state.glPending = { id: id, resolve: resolve };
        try { root.postMessage({ source: TAG, kind: "gl-snapshot-request", reqId: id, latestFrame: !!latestFrame }, ORIGIN); } catch (e) {}
        setTimeout(function () {
          if (state.glPending && state.glPending.id === id) { state.glPending = null; resolve({ meshes: null, summary: null, timedOut: true }); }
        }, 6000);
      });
    }
    // ---- commands ----
    var commands = {
      // the aligner on screen: exact teeth + the real gums ripped from WebGL
      fullMouth: function (args) {
        var stage = resolveStage(args && args.override);
        return snapshot().then(function (snap) {
          var res = engine.exportFromBundle(state.bytes, { stage: stage, glb: true, glMeshes: snap.meshes || [] });
          var gums = (res.gumInfo && res.gumInfo.gums) || [];
          var arches = gums.map(function (g) { return g.arch; });
          var lines = [
            "Teeth Exporter (unofficial)",
            "Aligner Number " + (stage + 1) + "  |  units: millimeters, true scale", "",
            gums.length
              ? "Real gums included: " + arches.join(" + ") + "   (fit: " + gums.map(function (g) { return g.arch + " " + g.cost + "mm"; }).join(", ") + ")"
              : (snap.timedOut
                  ? "NO GUMS THIS PASS: the 3D capture did not answer in time. Export again."
                  : "NO GUMS THIS PASS: orbit the model so both pink gums are drawn, then export again."),
            (snap.summary && snap.summary.budgetExceeded)
              ? "NOTE: the capture memory limit was hit, so the gum may be from an earlier aligner. Reload the page, go to the aligner you want, then export."
              : "",
            "",
            "Top level (the everyday files):",
            "  full_mouth_with_gums.stl   both arches: teeth + real gums",
            "  upper_with_gums.stl        upper: teeth + gum",
            "  lower_with_gums.stl        lower: teeth + gum",
            "  full_mouth.glb             colored, separate meshes, opens in any 3D viewer",
            "  (an arch whose gum wasn't captured shows its teeth-only file here instead)",
            "",
            "Advanced/ (everything else):",
            "  full_mouth_teeth.stl / upper_teeth.stl / lower_teeth.stl   teeth only",
            "  full_mouth_gums.stl / gum_U.stl / gum_L.stl                 gums only",
            "",
            "  manifest.json                                              per-tooth arch / UNS number / width (mm)",
            "  README.txt                                                 this file", "",
            "Teeth are an exact extraction. Gums are the viewer's own generated surface, ripped from WebGL."
          ];
          // same layout as each folder of the every-aligner export: everyday files on top, rest in Advanced/
          download(engine.zipOutputs(engine.layoutStage(res.outputs, ""), { "Advanced/manifest.json": text(JSON.stringify(res.manifest, null, 2)), "Advanced/README.txt": text(lines.join("\n")) }),
            "teeth_exporter_full_mouth_" + ts() + ".zip");
          return { ok: true, aligner: stage + 1, teeth: res.stats.teeth, arches: arches, timedOut: !!snap.timedOut };
        });
      },
      // every aligner with its real gums, one folder each (all_stages.js steps the viewer)
      allStages: function () {
        state.progress = { aligner: null, total: null };
        return root.TeethAllStages({
          tag: TAG, origin: ORIGIN, tokens: state.tokens, engine: engine, fflate: root.fflate, bytes: state.bytes,
          onProgress: function (p) { state.progress = { aligner: p.aligner, total: p.total }; emit("onProgress", state.progress); },
          isCancelled: function () { return state.cancelled; }
        }).then(function (res) {
          download(res.chunks, "teeth_exporter_all_aligners_" + ts() + ".zip");
          return { ok: true, count: res.stageCount, missing: res.missing, bytes: res.bytes };
        });
      },
      // the untouched scan file the viewer loaded (backup, offline tools, bug reports)
      raw: function () {
        download(state.bytes, "teeth_exporter_raw_scan_" + ts() + ".zip");
        return Promise.resolve({ ok: true, bytes: state.size });
      },
      // every mesh/archive the viewer downloaded + a redacted index of all responses
      diag: function () {
        var entries = {};
        for (var name in state.payloads) entries[name] = state.payloads[name];
        entries["index.json"] = text(JSON.stringify({
          capturedAt: new Date().toISOString(),
          wccBundle: state.bytes ? { size: state.size, url: safeUrl(state.url) } : null,
          meshFilesKept: Object.keys(state.payloads),
          allResponses: state.resources.map(function (r) { return { url: safeUrl(r.url), ct: r.ct, size: r.size, fmt: r.fmt, file: r.file }; })
        }, null, 2));
        download(engine.zipOutputs({}, entries), "teeth_exporter_diagnostics_" + ts() + ".zip");
        return Promise.resolve({ ok: true, files: Object.keys(state.payloads).length, responses: state.resources.length });
      },
      // what's on screen right now as a clean GLB: the latest frame's 3D meshes in the viewer's own
      // frame, unregistered (troubleshooting). Teeth white, gums pink.
      glCapture: function () {
        return snapshot(true).then(function (snap) {
          var all = snap.meshes || [];
          if (!all.length) return { ok: false, error: "No rendered 3D captured yet. Rotate the model once, then try again." };
          // the viewer draws some helper geometry whose bytes decode to Infinity/NaN; a GLB can't hold
          // those (Blender rejects the whole file), so leave them out and list them in the manifest
          // ...and leave out the viewer's helper draws: full-screen passes and UI quads (a handful of
          // vertices, often in pixel or -1..1 screen units) that would dwarf a 7 cm jaw
          var meshes = [], skipped = [], helpers = 0;
          all.forEach(function (m) {
            var ok = m.positions && m.positions.length && engine.allFinite(m.positions) && m.indices && m.indices.length % 3 === 0;
            if (ok) for (var k = 0, nv = m.positions.length / 3; k < m.indices.length; k++) if (m.indices[k] >= nv) { ok = false; break; }
            if (!ok) { skipped.push(m); return; }
            var p = m.positions, big = 0;
            for (var q = 0; q < p.length; q++) { var a = Math.abs(p[q]); if (a > big) big = a; }
            if (p.length / 3 <= 8 || big > 0.5) { helpers++; return; }       // model is meters, a jaw is < 0.1 m
            meshes.push(m);
          });
          if (!meshes.length) return { ok: false, error: "The captured 3D had no usable meshes. Rotate the model once, then try again." };
          var WHITE = [0.925, 0.914, 0.878, 1], PINK = [0.86, 0.42, 0.44, 1];
          var objs = meshes.map(function (m, i) {
            var gumLike = m.positions.length / 3 >= 3000;                     // gums are the big shells
            return { name: m.name || ("draw" + i), verts: m.positions, faces: m.indices, color: gumLike ? PINK : WHITE };
          });
          var manifest = { summary: snap.summary, drawCount: meshes.length, draws: meshes.map(function (m) { return m.meta; }),
            skipped: skipped.map(function (m) { return { name: m.name, meta: m.meta, reason: "invalid vertex or index data" }; }),
            helperDrawsLeftOut: helpers };
          download(engine.zipOutputs({ "rendered_meshes.glb": engine.buildGLB(objs) }, { "manifest.json": text(JSON.stringify(manifest, null, 2)) }),
            "teeth_exporter_rendered_3d_" + ts() + ".zip");
          return { ok: true, count: meshes.length, skipped: skipped.length };
        });
      }
    };

    function status() {
      return {
        captured: !!state.bytes, size: state.size,
        aligner: state.currentStep != null ? state.currentStep + 1 : null, total: state.stepTotal,
        busy: state.busy, progress: state.busy === "allStages" ? state.progress : null,
        files: Object.keys(state.payloads).length
      };
    }
    function run(name, args) {
      var cmd = commands[name];
      if (!cmd) return Promise.resolve({ ok: false, error: "unknown command" });
      if (!state.bytes) return Promise.resolve({ ok: false, error: "No scan yet. Open your 3D treatment plan and let it load." });
      if (state.busy) return Promise.resolve({ ok: false, error: "Still working on the last export." });
      state.busy = name; state.cancelled = false;
      emit("onRunStart", name);
      var p;
      try { p = cmd(args); } catch (e) { p = Promise.reject(e); }
      return p.then(function (r) { return r; }, function (e) { return { ok: false, error: String(e && e.message || e) }; })
        .then(function (r) { state.busy = null; state.progress = null; emit("onRunEnd", { name: name, result: r }); return r; });
    }
    function cancel() { if (state.busy === "allStages") state.cancelled = true; }

    return { state: state, status: status, run: run, cancel: cancel };
  }

  root.TeethController = TeethController;
})(typeof globalThis !== "undefined" ? globalThis : this);



/* ===================== src/ui_panel.js ===================== */
/*
 * ui_panel.js — the ONE panel both builds show. The extension popup and the userscript's floating
 * panel both call TeethPanel, so they look and behave the same; only the adapter differs (the popup
 * messages the tab, the userscript calls its controller directly).
 *
 * Styles go in through a constructable stylesheet (adoptedStyleSheets), which a strict page CSP
 * can't strip, so the floating panel looks right on any viewer page. Design: Workshop Standard
 * (mono base, mono uppercase labels, 1px rules, square corners, no shadows, light + dark).
 *
 * Exposes globalThis.TeethPanel({ mount, adapter, mode }) -> { refresh() }
 *   mount    element or ShadowRoot to render into
 *   adapter  { status() -> Promise<status|null>, run(name, args) -> Promise<result|null> }
 *            null means the viewer can't be reached
 *   mode     "popup" | "floating"
 */
(function (root) {
  "use strict";

  // The look. Kept as a theme table so a future variant only adds colors, never layout.
  var THEMES = {
    mint: {                      // the chosen look (Jason, 2026-10-19)
      paper: "#FFFFFF", ink: "#16302B", ink2: "#4F6B65", ink3: "#93A8A3", line: "#E4EFEC", soft: "#EEF8F5",
      primary: "#2BB58A", primaryHover: "#239C76", primaryInk: "#FFFFFF", chip: "#DDF5EC", chipInk: "#17785A",
      ok: "#2BB58A", err: "#D9534F", errBg: "#FDECEA", radius: "16px", btnRadius: "12px", head: "#F3FBF8",
      shadow: "0 10px 30px rgba(20,40,60,.12)",
      // dark mode (follows the system setting). Dark text on the green keeps the button readable.
      dark: {
        paper: "#131A19", ink: "#E6F2EE", ink2: "#A3B8B2", ink3: "#6D827C", line: "#25312E", soft: "#1A2422",
        primary: "#34C496", primaryHover: "#4AD3A7", primaryInk: "#0C251D", chip: "#173A2F", chipInk: "#86E3C2",
        ok: "#34C496", err: "#FF8A80", errBg: "#3A1F1E", head: "#17221F", shadow: "0 10px 30px rgba(0,0,0,.45)"
      }
    }
  };

  function cssFor(name) {
    var t = THEMES[name] || THEMES.mint;
    function colors(c) {
      return "--paper:" + c.paper + ";--ink:" + c.ink + ";--ink-2:" + c.ink2 + ";--ink-3:" + c.ink3 + ";--line:" + c.line + ";--soft:" + c.soft + ";" +
        "--primary:" + c.primary + ";--primary-hover:" + c.primaryHover + ";--primary-ink:" + c.primaryInk + ";--chip:" + c.chip + ";--chip-ink:" + c.chipInk + ";" +
        "--ok:" + c.ok + ";--err:" + c.err + ";--err-bg:" + c.errBg + ";--head:" + c.head + ";--shadow:" + c.shadow + ";";
    }
    return [
      ".te{" + colors(t),
      "--r:" + t.radius + ";--br:" + t.btnRadius + ";",
      "--ease:cubic-bezier(0.16,1,0.3,1);--sans:ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
      "box-sizing:border-box;width:320px;background:var(--paper);color:var(--ink);font:13px/1.5 var(--sans);",
      "-webkit-font-smoothing:antialiased;text-align:left;overflow:hidden;color-scheme:light;}",
      t.dark ? "@media (prefers-color-scheme:dark){.te{" + colors(t.dark) + "color-scheme:dark;}}" : "",
      ".te *,.te *::before,.te *::after{box-sizing:border-box;}",
      ".te[data-mode=popup]{max-height:590px;overflow-x:hidden;overflow-y:auto;}",
      ".te[data-mode=floating]{border:1px solid var(--line);border-radius:var(--r);max-height:calc(100vh - 32px);overflow-y:auto;",
      "box-shadow:var(--shadow);}",
      ".te-label{font:600 12px/1.3 var(--sans);color:var(--ink-2);}",
      ".te-head{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;background:var(--head);}",
      ".te-logo{width:30px;height:30px;flex:none;border-radius:10px;background:var(--primary);display:grid;place-items:center;}",
      ".te-logo svg{width:18px;height:18px;color:var(--primary-ink);}",
      ".te-title{font:700 15px/1.2 var(--sans);margin:0;color:var(--ink);flex:1;}",
      ".te-tag{font:600 10px/1 var(--sans);color:var(--ink-3);background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 8px;}",
      ".te-status{display:flex;align-items:center;padding:12px 16px 0;}",
      ".te-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;background:var(--soft);",
      "font:600 12px/1 var(--sans);color:var(--ink-2);transition:background-color 250ms var(--ease),color 250ms var(--ease);}",
      ".te-dot{width:7px;height:7px;border-radius:50%;background:var(--ink-3);flex:none;}",
      ".te-status[data-state=ready] .te-pill{background:var(--chip);color:var(--chip-ink);}",
      ".te-status[data-state=ready] .te-dot{background:var(--ok);}",
      ".te-status[data-state=busy] .te-pill{background:var(--chip);color:var(--chip-ink);}",
      ".te-status[data-state=busy] .te-dot{background:var(--primary);}",
      ".te-body{padding:14px 16px 16px;display:flex;flex-direction:column;}",
      ".te-btn{display:block;width:100%;padding:12px 16px;margin:0;border:1px solid var(--line);border-radius:var(--br);background:var(--paper);",
      "color:var(--ink);font:600 13px/1.2 var(--sans);text-align:center;cursor:pointer;",
      "transition:background-color 200ms var(--ease),border-color 200ms var(--ease),transform 200ms var(--ease);}",
      ".te-btn:hover:not(:disabled){background:var(--soft);border-color:var(--ink-3);}",
      ".te-btn:active:not(:disabled){transform:scale(.98);}",
      ".te-btn--solid{background:var(--primary);border-color:var(--primary);color:var(--primary-ink);padding:14px 16px;font-size:14px;}",
      ".te-btn--solid:hover:not(:disabled){background:var(--primary-hover);border-color:var(--primary-hover);}",
      ".te-btn--quiet{font-weight:500;}",
      ".te-btn:disabled{opacity:.45;cursor:default;}",
      ".te-btn:focus-visible,.te-input:focus-visible,.te-adv summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}",
      ".te-hint{margin:7px 2px 14px;color:var(--ink-2);font-size:12px;line-height:1.5;}",
      ".te-hint:last-child{margin-bottom:0;}",
      ".te-msg{margin:0 16px 14px;padding:10px 12px;border-radius:calc(var(--r) - 6px);background:var(--chip);color:var(--chip-ink);font:500 12px/1.45 var(--sans);}",
      ".te-msg:empty{display:none;}",
      ".te-msg[data-err]{background:var(--err-bg);color:var(--err);}",
      ".te-help{margin:0;padding:0 0 0 18px;color:var(--ink-2);font-size:12.5px;}",
      ".te-help li{margin:0 0 6px;}",
      ".te-adv{border-top:1px solid var(--line);}",
      ".te-adv summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;}",
      ".te-adv summary::-webkit-details-marker{display:none;}",
      ".te-adv summary::after{content:'';width:7px;height:7px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);",
      "transform:rotate(45deg) translateY(-2px);transition:transform 250ms var(--ease);}",
      ".te-adv[open] summary::after{transform:rotate(-135deg) translateY(-2px);}",
      ".te-adv-body{padding:2px 16px 16px;display:flex;flex-direction:column;}",
      ".te-field{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      ".te-input{width:104px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;",
      "background:var(--paper);color:var(--ink);font:13px/1 var(--sans);}",
      ".te-input:focus{border-color:var(--primary);outline:none;}",
      ".te-rule{height:1px;background:var(--line);margin:2px 0 14px;}",
      ".te-sub{margin:0 0 8px;}",
      ".te-stack{display:flex;flex-direction:column;gap:8px;}",
      ".te-foot{display:block;padding:11px 16px 13px;border-top:1px solid var(--line);color:var(--ink-3);font:500 11px/1.3 var(--sans);text-align:center;}",
      "[hidden]{display:none !important;}",
      // progress overlay
      ".te.te-ov{position:fixed;inset:0;width:auto;display:grid;place-items:center;z-index:2147483647;overflow:hidden;",
      "background:color-mix(in srgb,var(--paper) 78%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);",
      "opacity:0;transition:opacity 300ms var(--ease);}",
      ".te.te-ov[data-on]{opacity:1;}",
      ".te-card{width:300px;max-width:calc(100vw - 32px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);",
      "box-shadow:var(--shadow);padding:22px 22px 18px;text-align:center;transform:translateY(12px);transition:transform 600ms var(--ease);}",
      ".te.te-ov[data-on] .te-card{transform:none;}",
      ".te-card .te-logo{margin:0 auto 12px;width:40px;height:40px;border-radius:12px;}",
      ".te-card .te-logo svg{width:24px;height:24px;}",
      ".te-ov-title{font:700 15px/1.3 var(--sans);margin:0 0 4px;}",
      ".te-ov-count{font:700 30px/1.1 var(--sans);margin:10px 0 12px;letter-spacing:-.01em;}",
      ".te-ov-count small{font-size:14px;font-weight:600;color:var(--ink-2);}",
      ".te-bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;}",
      ".te-bar i{display:block;height:100%;width:0;border-radius:999px;background:var(--primary);transition:width 500ms var(--ease);}",
      ".te-ov-note{margin:12px 0 14px;color:var(--ink-2);font-size:12px;line-height:1.5;}",
      ".te-card .te-btn{width:auto;display:inline-block;padding:9px 18px;}"
    ].join("");
  }

  function fmtSize(b) {
    if (!b && b !== 0) return "";
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
    if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
    return Math.round(b / 1024) + " KB";
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // the tooth mark, built with DOM calls (no innerHTML: Trusted Types pages reject it)
  function toothLogo() {
    var logo = el("span", "te-logo");
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M7 3c-2.2 0-4 1.9-4 4.6 0 2.3 1 3.6 1.6 5.6.6 2.2.7 7.8 2.9 7.8 1.6 0 1.5-4.6 2.6-5.9.5-.6 1.3-.6 1.8 0 1.1 1.3 1 5.9 2.6 5.9 2.2 0 2.3-5.6 2.9-7.8.6-2 1.6-3.3 1.6-5.6C21 4.9 19.2 3 17 3c-1.9 0-2.9 1.2-5 1.2S8.9 3 7 3z");
    [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]]
      .forEach(function (kv) { path.setAttribute(kv[0], kv[1]); });
    svg.appendChild(path); logo.appendChild(svg);
    return logo;
  }

  function addStyles(mount, CSS) {
    var host = mount.adoptedStyleSheets !== undefined ? mount : (mount.ownerDocument || document);
    try {
      var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS);
      host.adoptedStyleSheets = (host.adoptedStyleSheets || []).concat([sheet]);
      return;
    } catch (e) {}
    var st = el("style"); st.textContent = CSS; (mount.appendChild ? mount : document.head).appendChild(st);
  }

  var DEFAULT_THEME = "mint";

  function TeethPanel(opts) {
    var mount = opts.mount, adapter = opts.adapter, mode = opts.mode || "popup", theme = opts.theme || DEFAULT_THEME;
    var LOST = "Can't reach the viewer. Reload the viewer page, let it load, then try again.";
    addStyles(mount, cssFor(theme));

    var rootEl = el("div", "te"); rootEl.setAttribute("data-mode", mode);

    var head = el("header", "te-head");
    var logo = toothLogo();
    head.appendChild(logo);
    head.appendChild(el("h1", "te-title", "Teeth Exporter"));
    head.appendChild(el("span", "te-tag", "Unofficial"));

    var status = el("div", "te-status"); status.setAttribute("data-state", "waiting");
    var pill = el("span", "te-pill");
    pill.appendChild(el("span", "te-dot"));
    var statusText = el("span", null, "Checking this tab");
    pill.appendChild(statusText);
    status.appendChild(pill);

    // main actions (shown once a scan is captured)
    var main = el("div", "te-body");
    var btnOne = el("button", "te-btn te-btn--solid", "Export this aligner");
    var hintOne = el("p", "te-hint", "Teeth and real gums for the aligner on screen. Orbit the model once first so both gums get drawn.");
    var btnAll = el("button", "te-btn", "Export every aligner");
    var hintAll = el("p", "te-hint", "One folder per aligner, each with its real gums. About a second per aligner. Keep the viewer on screen.");
    [btnOne, hintOne, btnAll, hintAll].forEach(function (n) { main.appendChild(n); });

    // help (shown until a scan is captured)
    var help = el("div", "te-body");
    var ol = el("ol", "te-help");
    ["Open your ClinCheck 3D treatment plan in this tab.", "Let the 3D model load and rotate it once.", "The buttons show up here when the scan is ready."]
      .forEach(function (t) { ol.appendChild(el("li", null, t)); });
    help.appendChild(ol);

    var msg = el("p", "te-msg");

    // advanced
    var adv = el("details", "te-adv");
    var sum = el("summary"); sum.appendChild(el("span", "te-label", "Advanced")); adv.appendChild(sum);
    var advBody = el("div", "te-adv-body");
    var field = el("label", "te-field");
    field.appendChild(el("span", "te-label", "Aligner number"));
    var input = el("input", "te-input"); input.type = "number"; input.min = "1"; input.placeholder = "current";
    field.appendChild(input);
    var hintField = el("p", "te-hint", "Blank exports the aligner on screen. A number exports that aligner instead, numbered like the viewer's slider.");
    var btnRaw = el("button", "te-btn te-btn--quiet", "Download raw scan");
    var hintRaw = el("p", "te-hint", "The original scan file, untouched. A backup of your data, and the file to send with a bug report.");
    var rule = el("div", "te-rule");
    var sub = el("span", "te-label te-sub", "Troubleshooting");
    var stack = el("div", "te-stack");
    var btnDiag = el("button", "te-btn te-btn--quiet", "Download captured files");
    var btnGl = el("button", "te-btn te-btn--quiet", "Download rendered 3D");
    stack.appendChild(btnDiag); stack.appendChild(btnGl);
    var hintDiag = el("p", "te-hint", "For bug reports. Case IDs and private links are removed from the file list.");
    [field, hintField, btnRaw, hintRaw, rule, sub, stack, hintDiag].forEach(function (n) { advBody.appendChild(n); });
    adv.appendChild(advBody);

    var foot = el("span", "te-label te-foot", "Runs locally. Nothing is uploaded.");

    [head, status, main, help, msg, adv, foot].forEach(function (n) { rootEl.appendChild(n); });
    mount.appendChild(rootEl);

    var buttons = [btnOne, btnAll, btnRaw, btnDiag, btnGl];
    var running = false;

    function setMsg(t, isErr) {
      msg.textContent = t || "";
      if (isErr) msg.setAttribute("data-err", ""); else msg.removeAttribute("data-err");
    }
    function setStatus(stateName, t) { status.setAttribute("data-state", stateName); statusText.textContent = t; }

    function render(s) {
      if (!s) {
        setStatus("waiting", mode === "popup" ? "Open your ClinCheck viewer" : "Waiting for the viewer");
        main.hidden = true; adv.hidden = true; help.hidden = false;
        return;
      }
      if (!s.captured) {
        setStatus("waiting", "Waiting for the 3D plan to load");
        main.hidden = true; adv.hidden = true; help.hidden = false;
        return;
      }
      main.hidden = false; adv.hidden = false; help.hidden = true;
      var where = s.aligner != null ? "Aligner " + s.aligner + (s.total ? " / " + s.total : "") : "Scan";
      if (s.busy === "allStages" && s.progress && s.progress.total) setStatus("busy", "Capturing aligner " + s.progress.aligner + " of " + s.progress.total);
      else if (s.busy) setStatus("busy", where + " · working");
      else setStatus("ready", where + " · ready");
      buttons.forEach(function (b) { b.disabled = !!s.busy || running; });
      if (s.aligner != null && !input.value) input.placeholder = "current (" + s.aligner + ")";
      if (s.total) input.max = String(s.total);
    }

    function refresh() { return adapter.status().then(render, function () { render(null); }); }

    function overrideValue() { var v = (input.value || "").trim(); return v === "" ? null : (parseInt(v, 10) || 1); }

    function describe(name, r) {
      if (name === "fullMouth") {
        var a = r.arches || [];
        if (a.length >= 2) return ["Saved aligner " + r.aligner + ": " + r.teeth + " teeth and both gums.", false];
        if (a.length === 1) return ["Saved aligner " + r.aligner + " with only the " + (a[0] === "U" ? "upper" : "lower") + " gum. Orbit to show the other gum, then export again.", true];
        return [r.timedOut
          ? "Saved aligner " + r.aligner + " teeth only. The 3D capture did not answer in time. Export again."
          : "Saved aligner " + r.aligner + " teeth only. No gums yet: orbit the model so both gums get drawn, then export again.", true];
      }
      if (name === "allStages") {
        var miss = r.missing && r.missing.length;
        return ["Saved " + r.count + " aligners with real gums (" + fmtSize(r.bytes) + ")." + (miss ? " Gum missing on aligner " + r.missing.join(", ") + "." : ""), !!miss];
      }
      if (name === "raw") return ["Saved the raw scan (" + fmtSize(r.bytes) + ").", false];
      if (name === "diag") return ["Saved " + r.files + " captured files and an index of " + r.responses + " responses.", false];
      if (name === "glCapture") return ["Saved " + r.count + " rendered meshes." + (r.skipped ? " Left out " + r.skipped + " with broken data." : ""), false];
      return ["Done.", false];
    }

    var START = {
      fullMouth: "Capturing the gums and seating the teeth.",
      allStages: "Stepping through every aligner. Keep the viewer on screen." + (mode === "popup" ? " You can close this popup; the zip downloads when it's done." : ""),
      raw: "Saving the raw scan.", diag: "Bundling the captured files.", glCapture: "Capturing the rendered 3D."
    };

    function run(name) {
      if (running) return;
      running = true;
      buttons.forEach(function (b) { b.disabled = true; });
      setMsg(START[name] || "Working.");
      var args = name === "fullMouth" ? { override: overrideValue() } : null;
      adapter.run(name, args).then(function (r) {
        if (!r) { setMsg(LOST, true); return; }
        if (!r.ok) { setMsg(r.error || "That didn't work.", true); return; }
        var d = describe(name, r); setMsg(d[0], d[1]);
      }, function (e) { setMsg(String(e && e.message || e), true); })
        .then(function () { running = false; refresh(); });
    }

    btnOne.addEventListener("click", function () { run("fullMouth"); });
    btnAll.addEventListener("click", function () { run("allStages"); });
    btnRaw.addEventListener("click", function () { run("raw"); });
    btnDiag.addEventListener("click", function () { run("diag"); });
    btnGl.addEventListener("click", function () { run("glCapture"); });

    refresh();
    setInterval(refresh, 1000);
    return { refresh: refresh };
  }

  // ---- progress overlay over the viewer during "Export every aligner" ----
  // show({onCancel}) -> update({aligner,total}) -> finish(text) | hide()
  function TeethProgress() {
    var host = null, ov = null, count = null, bar = null, title = null, note = null, cancelBtn = null, hideTimer = null;
    function build() {
      host = document.createElement("div");
      host.id = "teeth-exporter-progress";
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      var shadow = host.attachShadow({ mode: "open" });
      addStyles(shadow, cssFor(DEFAULT_THEME));
      ov = el("div", "te te-ov");
      ov.setAttribute("role", "dialog"); ov.setAttribute("aria-live", "polite");
      var card = el("div", "te-card");
      card.appendChild(toothLogo());
      title = el("p", "te-ov-title", "Exporting every aligner");
      count = el("div", "te-ov-count", "Starting");
      var track = el("div", "te-bar"); bar = el("i"); track.appendChild(bar);
      note = el("p", "te-ov-note", "Capturing the real gums for each aligner. Keep this tab open and on screen.");
      cancelBtn = el("button", "te-btn", "Cancel");
      [title, count, track, note, cancelBtn].forEach(function (n) { card.appendChild(n); });
      ov.appendChild(card); shadow.appendChild(ov);
    }
    return {
      show: function (opts) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (!host) build();
        title.textContent = "Exporting every aligner";
        count.textContent = "Starting"; bar.style.width = "0%";
        note.textContent = "Capturing the real gums for each aligner. Keep this tab open and on screen.";
        cancelBtn.hidden = false; cancelBtn.disabled = false; cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = function () {
          cancelBtn.disabled = true; cancelBtn.textContent = "Stopping";
          note.textContent = "Finishing this aligner, then putting the viewer back.";
          if (opts && opts.onCancel) opts.onCancel();
        };
        (document.body || document.documentElement).appendChild(host);
        requestAnimationFrame(function () { ov.setAttribute("data-on", ""); });
      },
      update: function (p) {
        if (!host || !p || !p.total) return;
        count.textContent = "";
        count.appendChild(document.createTextNode(String(p.aligner)));
        count.appendChild(el("small", null, " of " + p.total));
        bar.style.width = Math.round(((p.aligner - 1) / p.total) * 100) + "%";
      },
      finish: function (text) {
        if (!host) return;
        bar.style.width = "100%";
        title.textContent = text || "Done";
        count.textContent = "Saved";
        note.textContent = "Your zip is downloading.";
        cancelBtn.hidden = true;
        hideTimer = setTimeout(this.hide, 1600);
      },
      hide: function () {
        if (!host) return;
        ov.removeAttribute("data-on");
        var h = host;
        setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 320);
      }
    };
  }

  root.TeethPanel = TeethPanel;
  root.TeethProgress = TeethProgress;
})(typeof globalThis !== "undefined" ? globalThis : this);



/* ===================== src/userscript_orchestrator.js ===================== */
/*
 * userscript_orchestrator.js — userscript glue. A Tampermonkey userscript with @grant none runs
 * everything in ONE page context, so capture.js / webgl_capture.js / viewer_bridge.js message this
 * same window. All behavior lives in controller.js and the panel is the shared ui_panel.js, the
 * same one the extension popup shows; here it floats in a Shadow DOM over the viewer.
 *
 * The panel appears in whichever frame captures the scan (iframe viewers get exactly one panel).
 * No chrome.* APIs; nothing leaves the page.
 */
(function () {
  "use strict";
  if (window.__teethExporterUI) return;
  window.__teethExporterUI = true;
  if (!globalThis.ClinCheckEngine || !globalThis.TeethController || !globalThis.TeethPanel) return;

  var mounted = false;
  var overlay = globalThis.TeethProgress();                  // same overlay the extension shows
  var ctl = globalThis.TeethController({
    onCapture: mount,
    onProgress: function (p) { overlay.update(p); },
    onRunStart: function (name) { if (name === "allStages") overlay.show({ onCancel: function () { ctl.cancel(); } }); },
    onRunEnd: function (e) {
      if (e.name !== "allStages") return;
      if (e.result && e.result.ok) overlay.finish("Saved " + e.result.count + " aligners"); else overlay.hide();
    }
  });

  function mount() {
    if (mounted) return;
    mounted = true;
    var host = document.createElement("div");
    host.id = "teeth-exporter-ui";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    var shadow = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    globalThis.TeethPanel({
      mount: shadow,
      mode: "floating",
      adapter: {
        status: function () { return Promise.resolve(ctl.status()); },
        run: function (name, args) { return ctl.run(name, args); }
      }
    });
  }
})();


})();
