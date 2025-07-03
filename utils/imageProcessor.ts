// Utility untuk menangani berbagai format gambar
export class ImageProcessor {
  static supportedFormats = {
    standard: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
    heic: ['image/heic', 'image/heif'],
    raw: ['.cr2', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef', '.srw'],
    other: ['image/tiff', 'image/svg+xml']
  };

  static async processFile(file: File): Promise<string> {
    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    
    // Check if it's a standard format
    if (this.supportedFormats.standard.includes(fileType)) {
      return this.processStandardImage(file);
    }
    
    // Check if it's HEIC/HEIF
    if (this.supportedFormats.heic.includes(fileType) || fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
      return this.processHEICImage(file);
    }
    
    // Check if it's RAW format
    if (this.supportedFormats.raw.some(ext => fileName.endsWith(ext))) {
      return this.processRAWImage(file);
    }
    
    // Check if it's TIFF
    if (fileType === 'image/tiff' || fileName.endsWith('.tiff') || fileName.endsWith('.tif')) {
      return this.processTIFFImage(file);
    }
    
    throw new Error(`Format file ${file.name} tidak didukung. Silakan gunakan format JPG, PNG, HEIC, atau RAW.`);
  }

  private static async processStandardImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
      reader.readAsDataURL(file);
    });
  }

  private static async processHEICImage(file: File): Promise<string> {
    try {
      // Import heic2any dynamically
      const heic2any = (await import('heic2any')).default;
      
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.9
      }) as Blob;
      
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Gagal mengkonversi file HEIC'));
        reader.readAsDataURL(convertedBlob);
      });
    } catch (error) {
      throw new Error('Gagal memproses file HEIC. Pastikan file tidak corrupt.');
    }
  }

  private static async processRAWImage(file: File): Promise<string> {
    // Untuk RAW files, kita perlu menggunakan service eksternal atau library khusus
    // Karena keterbatasan browser, kita akan memberikan instruksi kepada user
    throw new Error(`File RAW (${file.name}) terdeteksi. Untuk hasil terbaik, silakan konversi ke JPG terlebih dahulu menggunakan software seperti Adobe Lightroom, Capture One, atau RawTherapee, lalu upload kembali.`);
  }

  private static async processTIFFImage(file: File): Promise<string> {
    // TIFF support is limited in browsers, but we can try
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Create an image to test if browser can handle it
        const img = new Image();
        img.onload = () => resolve(result);
        img.onerror = () => reject(new Error('Browser tidak dapat membaca file TIFF ini. Silakan konversi ke JPG terlebih dahulu.'));
        img.src = result;
      };
      reader.onerror = () => reject(new Error('Gagal membaca file TIFF'));
      reader.readAsDataURL(file);
    });
  }

  static getFileInfo(file: File): { 
    isSupported: boolean; 
    type: 'standard' | 'heic' | 'raw' | 'tiff' | 'unsupported';
    needsConversion: boolean;
    message?: string;
  } {
    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    
    if (this.supportedFormats.standard.includes(fileType)) {
      return { isSupported: true, type: 'standard', needsConversion: false };
    }
    
    if (this.supportedFormats.heic.includes(fileType) || fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
      return { 
        isSupported: true, 
        type: 'heic', 
        needsConversion: true,
        message: 'File HEIC akan dikonversi ke JPG secara otomatis'
      };
    }
    
    if (this.supportedFormats.raw.some(ext => fileName.endsWith(ext))) {
      return { 
        isSupported: false, 
        type: 'raw', 
        needsConversion: true,
        message: 'File RAW perlu dikonversi ke JPG terlebih dahulu'
      };
    }
    
    if (fileType === 'image/tiff' || fileName.endsWith('.tiff') || fileName.endsWith('.tif')) {
      return { 
        isSupported: true, 
        type: 'tiff', 
        needsConversion: false,
        message: 'File TIFF mungkin perlu waktu lebih lama untuk diproses'
      };
    }
    
    return { 
      isSupported: false, 
      type: 'unsupported', 
      needsConversion: true,
      message: 'Format file tidak didukung'
    };
  }
}