export interface EventInfo {
  babyName: string;
  babyNameEn: string;
  birthDate: string;
  eventDate: string;
  locationName: string;
  address: string;
  naverMapUrl: string;
  parentsNames: string;
  fatherName: string;
  motherName: string;
  brotherName?: string;
  fatherContact: string;
  motherContact: string;
  greetingText: string;
  mainPhotos: string[];
  bgmUrl?: string;
}

export interface GuestbookMessage {
  id?: string;
  sender: string;
  content: string;
  createdAt: any; // Firestore Timestamp
}

export interface GalleryPhoto {
  id?: string;
  url: string;
  description?: string;
  createdAt: any;
}
