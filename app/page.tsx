"use client";

import React, { useState, useRef, useEffect, useCallback, ChangeEvent, DragEvent } from 'react';

// Custom hook for debouncing a value
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}

// Tipe untuk objek LUT (Look-Up Table)
interface Lut {
    size: number;
    data: Uint8ClampedArray;
}

// Struktur data baru untuk grup preset
const presetGroups = [
    {
        label: "Film Preset",
        options: [
            { value: 'Film10.cube', label: 'Film 10' },
        ],
    },
    {
        label: "Signature Preset",
        options: [
            { value: 'Misty.cube', label: 'Misty' },
        ],
    }
];

const parseCubeFileForPreview = async (url: string): Promise<Lut | null> => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Gagal mengambil ${url}`);
        const text = await response.text();
        const lines = text.split('\n');
        let size = 0;
        const lutData: number[] = [];

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
        if (size === 0) return null;
        return { size, data: new Uint8ClampedArray(lutData) };
    } catch (error) {
        console.error("Gagal mem-parsing file .cube untuk pratinjau:", error);
        // Fallback to an identity LUT in case of an error loading the LUT file
        const size = 32;
        const identityLutData = [];
        for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
            identityLutData.push((r / (size - 1)) * 255, (g / (size - 1)) * 255, (b / (size - 1)) * 255, 255);
        }
        return { size, data: new Uint8ClampedArray(identityLutData) };
    }
};

const applyLUTForPreview = (lut: Lut, r: number, g: number, b: number): [number, number, number] => {
    const size = lut.size;
    const maxIndex = size - 1;
    const rIndex = Math.round((r / 255) * maxIndex);
    const gIndex = Math.round((g / 255) * maxIndex);
    const bIndex = Math.round((b / 255) * maxIndex);
    const lutIndex = bIndex * size * size + gIndex * size + rIndex;
    const baseIdx = lutIndex * 4;
    const lutData = lut.data;
    if (baseIdx + 2 >= lutData.length) return [r, g, b];
    return [lutData[baseIdx], lutData[baseIdx + 1], lutData[baseIdx + 2]];
};


export default function App() {
    // Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
    const afterCanvasRef = useRef<HTMLCanvasElement>(null);
    const sliderContainerRef = useRef<HTMLDivElement>(null);
    const isRenderingRef = useRef(false);

    // State
    const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
    const [fullResImageSrc, setFullResImageSrc] = useState<string | null>(null);
    const [activeLut, setActiveLut] = useState<Lut | null>(null);
    const [activeCategory, setActiveCategory] = useState<string>(presetGroups[0].label);
    const [selectedPreset, setSelectedPreset] = useState<string>(presetGroups[0].options[0].value);
    const [isLutLoading, setIsLutLoading] = useState<boolean>(false);
    const [isCanvasBusy, setIsCanvasBusy] = useState<boolean>(false);
    const [lastChangedSlider, setLastChangedSlider] = useState<string | null>(null);
    const [buyLink, setBuyLink] = useState<string>('https://masarif.id'); // New state for dynamic link

    // UI states (update instantly)
    const [exposure, setExposure] = useState<number>(0);
    const [whiteBalance, setWhiteBalance] = useState<number>(0);
    const [highlights, setHighlights] = useState<number>(0);
    const [shadows, setShadows] = useState<number>(0);
    const [grain, setGrain] = useState<number>(10);
    
    // Debounced states (for triggering canvas render)
    const debouncedExposure = useDebounce(exposure, 200);
    const debouncedWhiteBalance = useDebounce(whiteBalance, 200);
    const debouncedHighlights = useDebounce(highlights, 200);
    const debouncedShadows = useDebounce(shadows, 200);
    const debouncedGrain = useDebounce(grain, 200);

    const [isProcessing, setIsProcessing] = useState(false);
    const [sliderPosition, setSliderPosition] = useState(50);
    const [isDragging, setIsDragging] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
    const [isProcessComplete, setIsProcessComplete] = useState(false);
    const [progress, setProgress] = useState(0);

    // Efek untuk memuat LUT
    useEffect(() => {
        const loadLutForPreview = async () => {
            setIsLutLoading(true);
            try {
                const lut = await parseCubeFileForPreview(`/${selectedPreset}`);
                setActiveLut(lut);
            } catch (error) {
                console.error("Gagal memuat LUT:", error);
            } finally {
                setIsLutLoading(false);
            }
        };
        loadLutForPreview();
    }, [selectedPreset]);

    // Effect to update buyLink based on activeCategory
    useEffect(() => {
        if (activeCategory === "Film Preset") {
            setBuyLink("https://store.masarif.id/film");
        } else if (activeCategory === "Signature Preset") {
            setBuyLink("https://store.masarif.id/preset");
        } else {
            setBuyLink("https://masarif.id"); // Default or fallback link
        }
    }, [activeCategory]);


    // Efek untuk merender pratinjau (sekarang menggunakan nilai debounced)
    useEffect(() => {
        if (!previewImage || !activeLut || isLutLoading) return;
        
        setIsCanvasBusy(true);

        const processTimeout = setTimeout(() => {
            if (isRenderingRef.current) {
                setIsCanvasBusy(false);
                return;
            }
            isRenderingRef.current = true;
            
            const beforeCanvas = beforeCanvasRef.current;
            const afterCanvas = afterCanvasRef.current;
            if (!beforeCanvas || !afterCanvas) {
                isRenderingRef.current = false;
                setIsCanvasBusy(false);
                return;
            }

            const ctxBefore = beforeCanvas.getContext('2d', { willReadFrequently: true });
            const ctxAfter = afterCanvas.getContext('2d');
            if (!ctxBefore || !ctxAfter) {
                isRenderingRef.current = false;
                setIsCanvasBusy(false);
                return;
            }

            const width = previewImage.width;
            const height = previewImage.height;
            beforeCanvas.width = afterCanvas.width = width;
            beforeCanvas.height = afterCanvas.height = height;

            ctxBefore.drawImage(previewImage, 0, 0, width, height);
            const imageData = ctxBefore.getImageData(0, 0, width, height);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                let r = data[i], g = data[i+1], b = data[i+2];
                const expFactor = debouncedExposure * 2.55; r += expFactor; g += expFactor; b += expFactor;
                const wbFactor = debouncedWhiteBalance * 2; r += wbFactor; b -= wbFactor;
                const hFactor = debouncedHighlights / 100.0;
                if (hFactor > 0) { r += (255 - r) * hFactor; g += (255 - g) * hFactor; b += (255 - b) * hFactor; }
                else { r += r * hFactor; g += g * hFactor; b += b * hFactor; }
                const sFactor = debouncedShadows / 100.0;
                if (sFactor > 0) {
                    const threshold = 128;
                    if (r < threshold) r *= (1 + sFactor);
                    if (g < threshold) g *= (1 + sFactor);
                    if (b < threshold) b *= (1 + sFactor);
                } else {
                    r *= (1 + sFactor); g *= (1 + sFactor); b *= (1 + sFactor);
                }
                r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
                [r, g, b] = applyLUTForPreview(activeLut, r, g, b);
                if (debouncedGrain > 0) {
                    const noise = (Math.random() - 0.5) * debouncedGrain;
                    r = Math.max(0, Math.min(255, r + noise)); g = Math.max(0, Math.min(255, g + noise)); b = Math.max(0, Math.min(255, b + noise));
                }
                data[i] = r; data[i + 1] = g; data[i + 2] = b;
            }
            ctxAfter.putImageData(imageData, 0, 0);
            isRenderingRef.current = false;
            setIsCanvasBusy(false);
        }, 20);

        return () => clearTimeout(processTimeout);

    }, [previewImage, activeLut, debouncedExposure, debouncedWhiteBalance, debouncedHighlights, debouncedShadows, debouncedGrain, isLutLoading]);

    // Handler untuk input file
    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const resultSrc = event.target?.result as string;
                setFullResImageSrc(resultSrc);
                const img = new Image();
                img.onload = () => {
                    const maxW = 1280;
                    const ratio = img.width > maxW ? maxW / img.width : 1;
                    const canvas = document.createElement("canvas");
                    canvas.width = img.width * ratio;
                    canvas.height = img.height * ratio;
                    const ctx = canvas.getContext("2d");
                    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const resizedImage = new Image();
                    resizedImage.onload = () => { setPreviewImage(resizedImage); };
                    resizedImage.src = canvas.toDataURL();
                };
                img.src = resultSrc;
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => e.preventDefault();
    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files && files.length > 0 && fileInputRef.current) {
            fileInputRef.current.files = files;
            const event = new Event('change', { bubbles: true });
            fileInputRef.current.dispatchEvent(event);
        }
    };
    
    // Handler untuk slider pembanding
    const handleSliderMove = useCallback((clientX: number) => {
        if (!isDragging || !sliderContainerRef.current) return;
        const rect = sliderContainerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percent = (x / rect.width) * 100;
        setSliderPosition(percent);
    }, [isDragging]);

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => handleSliderMove(e.clientX);
        const handlePointerUp = () => setIsDragging(false);
        if (isDragging) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isDragging, handleSliderMove]);

    // Handler utama untuk memproses gambar
    const handleProcessImage = async () => {
        if (!fullResImageSrc || !selectedPreset) {
            setErrorMessage("Gambar atau preset belum siap.");
            setTimeout(() => setErrorMessage(null), 3000);
            return;
        }

        setIsProcessing(true);
        setIsProcessComplete(false);
        setProgress(0);
        setErrorMessage(null);

        // Simulasi progress bar
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 95) {
                    clearInterval(interval);
                    return prev;
                }
                return prev + 5;
            });
        }, 100);

        try {
            const payload = {
                imageSrc: fullResImageSrc,
                lutFile: selectedPreset,
                settings: { exposure, whiteBalance, highlights, shadows, grain }
            };

            const response = await fetch('/api/process-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            clearInterval(interval);
            setProgress(100);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Gagal memproses di server.');
            }

            const result = await response.json();
            
            if (result.processedImageSrc) {
                setProcessedImageUrl(result.processedImageSrc);
                setIsProcessComplete(true);
            } else {
                throw new Error("Respon server tidak valid.");
            }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            clearInterval(interval);
            setErrorMessage(error.message || "Terjadi kesalahan.");
            setTimeout(() => {
                setErrorMessage(null)
                setIsProcessing(false); // Sembunyikan modal jika error
            }, 4000);
        }
    };
    
    // Fungsi untuk menutup modal
    const closeModal = () => {
        setIsProcessing(false);
        setIsProcessComplete(false);
        setProcessedImageUrl(null);
        setProgress(0);
    }
    
    const resetAll = () => {
        setPreviewImage(null);
        setFullResImageSrc(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        resetSliders();
    };

    const resetSliders = () => {
        setExposure(0);
        setWhiteBalance(0);
        setHighlights(0);
        setShadows(0);
        setGrain(10);
    };
    
    const slidersConfig = [
      { id: 'exposure', label: 'Exposure', value: exposure, setter: setExposure, min: -100, max: 100, step: 1 },
      { id: 'whiteBalance', label: 'White Balance', value: whiteBalance, setter: setWhiteBalance, min: -100, max: 100, step: 1 },
      { id: 'highlights', label: 'Highlights', value: highlights, setter: setHighlights, min: -100, max: 100, step: 1 },
      { id: 'shadows', label: 'Shadows', value: shadows, setter: setShadows, min: -100, max: 100, step: 1 },
      { id: 'grain', label: 'Grain', value: grain, setter: setGrain, min: 0, max: 100, step: 1 },
    ];
    
    const handleCategoryClick = (categoryLabel: string) => {
        setActiveCategory(categoryLabel);
        // Set the selected preset to the first option of the new category
        const newGroup = presetGroups.find(group => group.label === categoryLabel);
        if (newGroup && newGroup.options.length > 0) {
            setSelectedPreset(newGroup.options[0].value);
        }
    }

    const currentOptions = presetGroups.find(group => group.label === activeCategory)?.options || [];

    return (
        <div className="bg-gray-100 w-full min-h-screen flex flex-col font-sans text-gray-800 md:h-screen md:overflow-hidden">
             {errorMessage && (
                    <div className="fixed top-5 right-5 bg-red-500 text-white py-2 px-4 rounded-lg shadow-lg z-[110] animate-pulse">
                        {errorMessage}
                    </div>
             )}

            {/* Modal Terpusat untuk Proses & Unduh */}
            {isProcessing && (
                <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4 transition-opacity duration-300">
                    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-md text-center animate-fade-in-up relative">
                        {!isProcessComplete ? (
                            // Tampilan saat memproses
                            <>
                                <h3 className="text-xl sm:text-2xl font-bold mb-4 text-gray-800">MEMPROSES FOTO</h3>
                                <p className="text-gray-600 mb-6">Ditunggu ya lagi di proses biar HD...</p>
                                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                                    <div
                                        className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-in-out"
                                        style={{ width: `${progress}%` }}
                                    ></div>
                                </div>
                                <p className="text-right text-sm font-mono text-gray-500 mt-2">{progress}%</p>
                            </>
                        ) : (
                            // Tampilan setelah proses selesai
                            <>
                                <button
                                    onClick={closeModal}
                                    className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-gray-200 rounded-full text-gray-600 hover:bg-gray-300 hover:text-gray-800 hover:rotate-90 transition-transform duration-300"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                                <h3 className="text-xl sm:text-2xl font-bold mb-2 text-gray-800">Proses Selesai!</h3>
                                <p className="text-sm text-gray-600 mb-4">Pratinjau gambar Anda di bawah ini.</p>
                                <div className="mb-5">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={processedImageUrl || ''}
                                        alt="Hasil Pratinjau"
                                        className="w-full h-auto object-contain rounded-lg max-h-[45vh] shadow-lg"
                                    />
                                </div>
                                <div className="flex flex-col items-center gap-4">
                                    <a
                                        href={processedImageUrl || ''}
                                        download="hasil_HD_by_masarif_id.jpg"
                                        className="w-full sm:w-auto inline-block bg-blue-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
                                    >
                                        Unduh Foto
                                    </a>
                                    <div className="text-center border-t border-gray-200 pt-4 w-full">
                                        <p className="font-semibold text-gray-800">Suka hasilnya?</p>
                                        <p className="text-sm text-gray-600 mb-3">Dapatkan preset lengkap dengan harga promo!</p>
                                        <a
                                            href={buyLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-block bg-teal-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-teal-600 transition-colors shadow"
                                        >
                                            Beli Sekarang
                                        </a>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <header className="flex-shrink-0 text-center py-4 bg-white/80 backdrop-blur-sm">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Preview Preset by @masarif.id</h1>
            </header>
            
            <main className="container mx-auto max-w-full px-4 sm:px-6 lg:px-8 flex-grow flex flex-col min-h-0">
                <div className="bg-white my-4 sm:my-6 rounded-2xl shadow-lg flex-grow flex flex-col min-h-0">
                    {!previewImage && (
                        <div className="flex-grow flex items-center justify-center p-6">
                            <div
                                className="w-full max-w-lg border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-blue-500 hover:bg-gray-50"
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <p className="mt-4 text-lg font-semibold text-gray-700">Klik atau Drop Foto di Sini</p>
                                <p className="text-sm text-gray-500 mt-1">Unggah foto untuk memulai editing</p>
                            </div>
                        </div>
                    )}
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

                    {previewImage && (
                        <div className="flex flex-col md:flex-row gap-6 p-4 sm:p-6 flex-grow min-h-0">
                            <div className="w-full md:w-80 lg:w-96 flex-shrink-0 order-last md:order-first md:h-full md:overflow-y-auto md:pr-4 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Pilih Kategori Preset</label>
                                    <div className="flex items-center gap-2 bg-gray-200 p-1 rounded-lg">
                                        {presetGroups.map(group => (
                                            <button
                                                key={group.label}
                                                onClick={() => handleCategoryClick(group.label)}
                                                className={`w-full text-sm font-semibold py-2 px-3 rounded-md transition-colors ${
                                                    activeCategory === group.label
                                                        ? 'bg-white text-blue-600 shadow'
                                                        : 'bg-transparent text-gray-600 hover:bg-white/50'
                                                }`}
                                            >
                                                {group.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="filterSelect" className="block text-sm font-medium text-gray-700">Pilih Preset</label>
                                        {isLutLoading && (
                                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-500"></div>
                                        )}
                                    </div>
                                    <select
                                        id="filterSelect"
                                        value={selectedPreset}
                                        onChange={(e) => setSelectedPreset(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                        disabled={isLutLoading}
                                    >
                                        {currentOptions.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                {slidersConfig.map(slider => (
                                    <div key={slider.id}>
                                        <div className="flex justify-between items-center mb-2">
                                            <label htmlFor={slider.id} className="text-sm font-medium text-gray-700">{slider.label}</label>
                                            <div className="flex items-center gap-2">
                                                {isCanvasBusy && lastChangedSlider === slider.id && <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-400"></div>}
                                                <span className="text-sm font-mono bg-gray-200 text-gray-800 px-2 py-0.5 rounded-md w-12 text-center">{slider.value}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => {
                                                    setLastChangedSlider(slider.id);
                                                    slider.setter(val => Math.max(slider.min, val - slider.step));
                                                }}
                                                className="w-10 h-8 flex-shrink-0 flex items-center justify-center bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 active:bg-gray-400 transition-colors text-xl font-bold select-none"
                                            >
                                                -
                                            </button>
                                            <input
                                                type="range"
                                                id={slider.id}
                                                min={slider.min}
                                                max={slider.max}
                                                step={slider.step}
                                                value={slider.value}
                                                onChange={(e) => {
                                                    setLastChangedSlider(slider.id);
                                                    slider.setter(Number(e.target.value));
                                                }}
                                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer range-thumb"
                                            />
                                            <button
                                                onClick={() => {
                                                    setLastChangedSlider(slider.id);
                                                    slider.setter(val => Math.min(slider.max, val + slider.step));
                                                }}
                                                className="w-10 h-8 flex-shrink-0 flex items-center justify-center bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 active:bg-gray-400 transition-colors text-xl font-bold select-none"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div className="pt-4 space-y-3">
                                   <button onClick={resetSliders} className="w-full bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600 transition-colors">
                                        Reset Slider
                                    </button>
                                   <button onClick={handleProcessImage} disabled={isProcessing} className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-500 disabled:cursor-not-allowed flex items-center justify-center">
                                        {isProcessing ? 'Memproses...' : 'Proses & Download Foto HD'}
                                    </button>
                                   <button onClick={resetAll} className="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors">
                                        Ganti Foto
                                    </button>
                                    <div className="mt-6 text-center border-t border-gray-200 pt-4">
                                        <p className="font-semibold text-gray-800">Suka hasilnya?</p>
                                        <p className="text-sm text-gray-600 mb-3">Beli presetnya dengan harga promo</p>
                                        <a
                                            href={buyLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-block bg-teal-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-teal-600 transition-colors shadow"
                                        >
                                            Beli
                                        </a>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-grow order-first md:order-last relative flex items-center justify-center min-h-[300px] md:min-h-0">
                                <div
                                    ref={sliderContainerRef}
                                    style={{ aspectRatio: `${previewImage.width} / ${previewImage.height}` }}
                                    className="relative max-w-full max-h-full rounded-lg shadow-inner overflow-hidden bg-gray-200"
                                >
                                    {/* Base canvas, fills the container */}
                                    <canvas
                                        ref={afterCanvasRef}
                                        className="block w-full h-full"
                                    />
                                    {/* Clipper div is positioned absolutely on top of the base canvas */}
                                    <div
                                        className="absolute inset-0"
                                        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                                    >
                                        {/* Before canvas fills the clipper */}
                                        <canvas
                                            ref={beforeCanvasRef}
                                            className="block w-full h-full"
                                        />
                                    </div>
                                    <div className="absolute top-0 bottom-0 w-1 bg-white/70 backdrop-blur-sm cursor-ew-resize" style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }} onPointerDown={() => setIsDragging(true)} onTouchStart={() => setIsDragging(true)}>
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full shadow-lg grid place-items-center backdrop-blur-sm">
                                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-4-4 4-4m2 8l4-4-4-4" /></svg>
                                        </div>
                                    </div>
                                    <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded-full pointer-events-none">Sebelum</span>
                                    <span className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded-full pointer-events-none">Sesudah</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
            <footer className="text-center p-4 text-xs text-gray-500 flex-shrink-0">
                <p>🔒 Tenang, privasi Kamu tetap aman. Foto tidak pernah disimpan ke server, Semua proses edit dilakukan langsung di browser perangkat Kamu.</p>
            </footer>
        </div>
    );
}
