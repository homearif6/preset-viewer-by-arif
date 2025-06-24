// File: app/api/process-image/route.js
// VERSI HYBRID: Menggunakan 'canvas' untuk pemrosesan di server.

import { NextResponse } from 'next/server';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs/promises';
import path from 'path';

const parseCubeFile = async (lutFileName) => {
    const filePath = path.join(process.cwd(), 'presets', lutFileName);
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        let size = 0;
        const lutData = [];
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) continue;
            if (trimmedLine.startsWith('LUT_3D_SIZE')) {
                size = parseInt(trimmedLine.split(' ')[1], 10);
            } else {
                const [r, g, b] = trimmedLine.split(/\s+/).map(Number);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    lutData.push(r * 255, g * 255, b * 255, 255);
                }
            }
        }
        if (size === 0) throw new Error("Invalid CUBE file format.");
        return { size, data: new Uint8ClampedArray(lutData) };
    } catch (error) {
        console.error(`[SERVER] Gagal membaca atau parsing file LUT: ${filePath}`, error);
        throw error;
    }
};

const applyLUT = (lut, r, g, b) => {
    if (!lut) return [r, g, b];
    const { size, data: lutData } = lut;
    const maxIndex = size - 1;
    const rIndex = Math.round((r / 255) * maxIndex);
    const gIndex = Math.round((g / 255) * maxIndex);
    const bIndex = Math.round((b / 255) * maxIndex);
    const lutIndex = bIndex * size * size + gIndex * size + rIndex;
    const baseIdx = lutIndex * 4;
    if (baseIdx + 2 >= lutData.length) return [r, g, b];
    return [lutData[baseIdx], lutData[baseIdx + 1], lutData[baseIdx + 2]];
};

export async function POST(request) {
    try {
        const { imageSrc, lutFile, settings } = await request.json();

        if (!imageSrc || !lutFile || !settings) {
            return new NextResponse(JSON.stringify({ error: 'Data yang dikirim tidak lengkap.' }), { status: 400 });
        }

        const lut = await parseCubeFile(lutFile);
        
        const image = await loadImage(imageSrc);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const { exposure, whiteBalance, highlights, shadows, grain } = settings;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i + 1], b = data[i + 2];
            
            const expFactor = exposure * 2.55;
            r += expFactor; g += expFactor; b += expFactor;
            const wbFactor = whiteBalance * 2;
            r += wbFactor; b -= wbFactor;
            const hFactor = highlights / 100.0;
            if (hFactor > 0) { r += (255 - r) * hFactor; g += (255 - g) * hFactor; b += (255 - b) * hFactor; }
            else { r += r * hFactor; g += g * hFactor; b += b * hFactor; }
            const sFactor = shadows / 100.0;
            if (sFactor > 0) {
                const threshold = 128;
                if (r < threshold) r *= (1 + sFactor);
                if (g < threshold) g *= (1 + sFactor);
                if (b < threshold) b *= (1 + sFactor);
            } else {
                r *= (1 + sFactor); g *= (1 + sFactor); b *= (1 + sFactor);
            }
            r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
            [r, g, b] = applyLUT(lut, r, g, b);
            if (grain > 0) {
                const noise = (Math.random() - 0.5) * grain;
                r = Math.max(0, Math.min(255, r + noise)); g = Math.max(0, Math.min(255, g + noise)); b = Math.max(0, Math.min(255, b + noise));
            }
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        ctx.putImageData(imageData, 0, 0);
        
        // PERBAIKAN: Mengubah output menjadi JPG dengan kualitas 90%
        // Ini akan menghasilkan ukuran file yang lebih kecil dan mempercepat unduhan.
        const processedImageSrc = canvas.toDataURL('image/jpeg', 0.9);
        
        return NextResponse.json({ processedImageSrc });

    } catch (error) {
        console.error("[SERVER] Terjadi error di handler utama:", error);
        if (error.code === 'ENOENT') {
            return new NextResponse(JSON.stringify({ error: `File preset tidak ditemukan. Pastikan folder 'presets' ada di root proyek Anda.` }), { status: 404 });
        }
        return new NextResponse(JSON.stringify({ error: 'Terjadi kesalahan internal di server.' }), { status: 500 });
    }
}
