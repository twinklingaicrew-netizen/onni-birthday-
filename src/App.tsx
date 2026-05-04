/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  MapPin, 
  Heart, 
  MessageSquare, 
  Phone, 
  ChevronRight, 
  ChevronLeft,
  X,
  Settings,
  ArrowRight,
  Share2,
  ExternalLink,
  Info,
  Music,
  Volume2,
  VolumeX,
  ImagePlus
} from 'lucide-react';
import { format, parseISO, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { db, auth, login, logout, handleFirestoreError, OperationType } from './lib/firebase';
import { 
  doc, 
  onSnapshot, 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  orderBy, 
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import type { EventInfo, GuestbookMessage, GalleryPhoto } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for tailwind class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper for image compression to stay within Firestore limits
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_SIZE = 1200;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

function MusicPlayer({ url }: { url?: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current || !url) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Playback failed:", e));
    }
    setIsPlaying(!isPlaying);
  };

  if (!url) return null;

  return (
    <div className="fixed bottom-24 right-6 z-40">
      <audio ref={audioRef} src={url} loop />
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={toggle}
        className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-all border-2",
          isPlaying ? "bg-brand-primary text-white border-brand-accent" : "bg-white text-brand-primary border-slate-100"
        )}
      >
        {isPlaying ? (
          <Volume2 size={20} />
        ) : (
          <div className="relative">
             <Music size={20} />
             <div className="absolute -top-1 -right-1 w-2 h-2 bg-brand-accent rounded-full animate-ping" />
          </div>
        )}
      </motion.button>
      <AnimatePresence>
        {isPlaying && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute right-14 top-1/2 -translate-y-1/2 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-medium text-brand-primary whitespace-nowrap shadow-sm border border-brand-accent/20"
          >
            기분 좋은 음악이 흐르고 있어요
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Default initial event data
const DEFAULT_EVENT_INFO: EventInfo = {
  babyName: '김온',
  babyNameEn: 'KIM ON',
  birthDate: '2025-05-10',
  eventDate: '2026-05-10T11:00:00',
  locationName: '경복궁 노원점 (창동점 아님)',
  address: '서울 노원구 동일로 1608 2층',
  naverMapUrl: 'https://map.naver.com/v5/search/%EA%B2%BD%EB%B3%B5%EA%B6%81%20%EB%85%B8%EC%9B%90%EC%A0%90',
  parentsNames: '아빠 김성수, 엄마 최윤라',
  fatherName: '김성수',
  motherName: '최윤라',
  brotherName: '김유',
  fatherContact: '010-0000-0000',
  motherContact: '010-0000-0000',
  greetingText: '소중한 우리 온이의 첫 번째 생일,\n그 기쁨을 함께 나누고 싶습니다.\n바쁘신 와중에도 자리를 빛내주시면 감사하겠습니다.',
  mainPhotos: [
    '/assets/main_solo.jpg',
    '/assets/main_sibling.jpg',
    '/assets/main_family.jpg'
  ],
  bgmUrl: '/assets/bgm.mp3' // Updated to standard name as per user request
};

export default function App() {
  const [eventInfo, setEventInfo] = useState<EventInfo>(DEFAULT_EVENT_INFO);
  const [messages, setMessages] = useState<GuestbookMessage[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [user, setUser] = useState(auth.currentUser);
  const [isAdminMode, setIsAdminMode] = useState(false);

  // Firestore Sync & Auto-fix for time
  useEffect(() => {
    // Sync Event Info
    const unsubInfo = onSnapshot(doc(db, 'config', 'main'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as EventInfo;
        
        // Path Sanitization: Fix any legacy double extensions in Firestore
        let needsUpdate = false;
        const sanitizedMainPhotos = data.mainPhotos.map(url => {
          if (url.includes('.png.jpg')) {
            needsUpdate = true;
            return url.replace('.png.jpg', '.jpg');
          }
          return url;
        });
        
        let sanitizedBgmUrl = data.bgmUrl;
        if (data.bgmUrl?.includes('.mp3.mp3')) {
          needsUpdate = true;
          sanitizedBgmUrl = data.bgmUrl.replace('.mp3.mp3', '.mp3');
        }

        const sanitizedData = {
          ...data,
          mainPhotos: sanitizedMainPhotos,
          bgmUrl: sanitizedBgmUrl
        };

        setEventInfo(sanitizedData);
        
        // Auto-fix: If it's specifically 11:00 PM (23:00), change it to 11:00 AM (11:00)
        // following user's persistent request.
        if (data.eventDate.includes('T23:00:00')) {
          sanitizedData.eventDate = data.eventDate.replace('T23:00:00', 'T11:00:00');
          needsUpdate = true;
        }

        if (needsUpdate) {
          setDoc(doc(db, 'config', 'main'), sanitizedData, { merge: true });
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/main'));

    // Sync Guestbook
    const qMsg = query(collection(db, 'guestbook'), orderBy('createdAt', 'desc'));
    const unsubMsg = onSnapshot(qMsg, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })) as GuestbookMessage[]);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'guestbook'));

    // Sync Gallery
    const qPhoto = query(collection(db, 'gallery'), orderBy('createdAt', 'desc'));
    const unsubPhoto = onSnapshot(qPhoto, (snap) => {
      setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() })) as GalleryPhoto[]);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'gallery'));

    // Auth sync
    const unsubAuth = auth.onAuthStateChanged((u) => setUser(u));

    return () => {
      unsubInfo();
      unsubMsg();
      unsubPhoto();
      unsubAuth();
    };
  }, []);

  const handleAddMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const sender = formData.get('sender') as string;
    const content = formData.get('content') as string;

    if (!sender || !content) return;

    try {
      await addDoc(collection(db, 'guestbook'), {
        sender,
        content,
        createdAt: serverTimestamp()
      });
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'guestbook');
    }
  };

  const handleLogin = async () => {
    try {
      await login();
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  const eventDate = parseISO(eventInfo.eventDate);

  return (
    <div className="min-h-screen bg-brand-paper pb-20">
      {/* Admin Toggle */}

      <div className="fixed top-4 right-4 z-50">
        <button 
          onClick={() => user ? setIsAdminMode(!isAdminMode) : handleLogin()}
          className="p-2 bg-white/80 backdrop-blur rounded-full shadow-lg border border-brand-accent/30 text-brand-primary"
        >
          {isAdminMode ? <X size={20} /> : <Settings size={20} />}
        </button>
      </div>

      {isAdminMode && user && (
        <AdminPanel 
          eventInfo={eventInfo} 
          setEventInfo={setEventInfo} 
          photos={photos}
          onLogout={logout}
        />
      )}

      {/* Music Player */}
      <MusicPlayer url={eventInfo.bgmUrl} />

      {/* Hero Section */}
      <section className="relative pt-12 px-6 flex flex-col items-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <span className="text-sm font-outfit tracking-[0.3em] text-brand-primary/60 uppercase">
            {eventInfo.babyNameEn} FIRST BIRTHDAY
          </span>
          <h1 className="text-4xl font-display mt-2 mb-1">
            {eventInfo.babyName} <span className="font-sans font-light italic text-2xl ml-1 text-brand-primary">첫</span><span className="font-sans font-light text-2xl text-brand-primary">돌</span>
          </h1>
          <p className="text-sm text-brand-primary font-light">
            2026. 05. 14.
          </p>
        </motion.div>

        {/* Photo Grid - Redesigned to highlight siblings better */}
        <div className="w-full max-w-sm mx-auto p-4 bg-white shadow-xl rotate-[-1deg] border border-brand-accent/20">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1 aspect-[3/4] overflow-hidden bg-slate-100">
              <img src={eventInfo.mainPhotos[0]} alt="Baby Solo" className="w-full h-full object-cover object-center" />
            </div>
            <div className="col-span-1 aspect-[3/4] overflow-hidden bg-slate-100">
              <img src={eventInfo.mainPhotos[1]} alt="Siblings" className="w-full h-full object-cover object-center" />
            </div>
            <div className="col-span-2 h-16 bg-brand-primary flex flex-col items-center justify-center text-brand-paper px-4 text-center">
               <span className="text-lg font-display leading-tight">{eventInfo.babyName}</span>
               <span className="text-[10px] mt-0.5 border-t border-brand-paper/30 pt-0.5 tracking-tighter italic">우리 온이의 첫 생일을 축하해 주셔서 감사합니다</span>
            </div>
            <div className="col-span-2 aspect-[16/9] overflow-hidden bg-slate-100">
              <img src={eventInfo.mainPhotos[2]} alt="Family" className="w-full h-full object-cover object-center" />
            </div>
          </div>
        </div>
        
        <div className="mt-12 text-center max-w-xs">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 italic">
            {eventInfo.greetingText}
          </p>
          <div className="mt-6 flex flex-col items-center gap-1">
            <div className="flex flex-wrap justify-center items-center gap-2 text-xs uppercase tracking-widest text-brand-primary/70">
              <span>아빠 {eventInfo.fatherName}</span>
              <div className="w-1 h-1 bg-brand-accent rounded-full" />
              <span>엄마 {eventInfo.motherName}</span>
              {eventInfo.brotherName && (
                <>
                  <div className="w-1 h-1 bg-brand-accent rounded-full" />
                  <span>오빠 {eventInfo.brotherName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Info Section */}
      <section className="mt-20 px-8 py-12 bg-white rounded-t-[50px] shadow-2xl relative overflow-hidden">
         <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-slate-100 rounded-full mt-4" />
         
         <div className="space-y-16">
           {/* Event Detail */}
           <div className="space-y-4">
             <div className="flex items-center gap-2 mb-6">
               <div className="h-px flex-1 bg-brand-accent/30" />
               <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Event Details</h2>
               <div className="h-px flex-1 bg-brand-accent/30" />
             </div>
             <div className="text-center space-y-2">
               <p className="text-xl font-display">{format(eventDate, 'yyyy. MM. dd. EEE', { locale: ko })}</p>
               <p className="text-lg text-slate-500">{format(eventDate, 'aaaa h시', { locale: ko })}</p>
               <p className="text-brand-primary font-medium">{eventInfo.locationName}</p>
             </div>
           </div>

           {/* Calendar */}
           <CalendarSection date={eventDate} eventInfo={eventInfo} />

           {/* Location / Map */}
           <div className="space-y-6">
             <div className="flex items-center gap-2">
               <div className="h-px flex-1 bg-brand-accent/30" />
               <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Location</h2>
               <div className="h-px flex-1 bg-brand-accent/30" />
             </div>
             <div className="text-center">
                <p className="text-sm text-slate-500 font-light mb-1 italic">{eventInfo.address}</p>
                <a 
                  href={eventInfo.naverMapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-brand-primary text-white rounded-full text-sm font-light tracking-wide shadow-lg"
                >
                  <MapPin size={16} />
                  네이버 지도에서 보기
                </a>
             </div>
           </div>

           {/* Contact */}
           <div className="space-y-6">
             <div className="flex items-center gap-2">
               <div className="h-px flex-1 bg-brand-accent/30" />
               <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Contact</h2>
               <div className="h-px flex-1 bg-brand-accent/30" />
             </div>
             <div className="flex justify-center gap-8">
               <ContactButton name="아빠" phone={eventInfo.fatherContact} color="bg-blue-50 text-blue-600" />
               <ContactButton name="엄마" phone={eventInfo.motherContact} color="bg-pink-50 text-pink-600" />
             </div>
           </div>

            {/* Gallery */}
            {photos.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-brand-accent/30" />
                  <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Gallery</h2>
                  <div className="h-px flex-1 bg-brand-accent/30" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {photos.map((p, idx) => (
                    <motion.div 
                      key={p.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.05 }}
                      className="aspect-square bg-slate-100 overflow-hidden rounded-xl shadow-sm cursor-zoom-in"
                    >
                      <img src={p.url} alt="" className="w-full h-full object-cover transition-transform hover:scale-110" />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Guestbook */}
           <div className="space-y-8">
             <div className="flex items-center gap-2">
               <div className="h-px flex-1 bg-brand-accent/30" />
               <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Guestbook</h2>
               <div className="h-px flex-1 bg-brand-accent/30" />
             </div>
             
             <form onSubmit={handleAddMessage} className="bg-brand-paper p-6 rounded-3xl space-y-4 shadow-inner">
               <input 
                 name="sender" 
                 type="text" 
                 placeholder="보내는 보시는 분 (이름)"
                 className="w-full px-4 py-3 bg-white rounded-xl text-sm focus:ring-1 focus:ring-brand-primary outline-none"
                 required
               />
               <textarea 
                 name="content"
                 placeholder="축하의 메시지를 남겨주세요"
                 rows={3}
                 className="w-full px-4 py-3 bg-white rounded-xl text-sm focus:ring-1 focus:ring-brand-primary outline-none resize-none"
                 required
               />
               <button 
                 type="submit"
                 className="w-full py-3 bg-brand-primary text-white rounded-xl text-sm font-medium shadow-md active:scale-[0.98] transition-transform"
               >
                 메시지 남기기
               </button>
             </form>

             <div className="space-y-4 max-h-[400px] overflow-y-auto px-1">
               {messages.map((m) => (
                 <div key={m.id} className="p-4 bg-slate-50 border border-brand-accent/10 rounded-2xl">
                   <div className="flex justify-between items-start mb-2">
                     <span className="font-semibold text-xs text-brand-primary">{m.sender}</span>
                     <span className="text-[10px] text-slate-400">
                       {m.createdAt?.toDate ? format(m.createdAt.toDate(), 'MM.dd') : ''}
                     </span>
                   </div>
                   <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{m.content}</p>
                 </div>
               ))}
             </div>
           </div>
         </div>
      </section>

      {/* Footer */}
      <footer className="mt-20 pb-20 text-center px-12">
        <Heart className="mx-auto text-brand-primary/30 mb-4 fill-current" size={24} />
        <p className="text-xs text-slate-400 font-light tracking-widest">
          Copyright 2026. {eventInfo.babyName} Family all rights reserved.
        </p>
      </footer>

    </div>
  );
}

function ContactButton({ name, phone, color }: { name: string; phone: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-tighter">{name}에게 연락하기</span>
      <div className="flex gap-2">
        <a href={`tel:${phone}`} className={cn("p-4 rounded-full shadow-sm", color)}>
          <Phone size={20} />
        </a>
        <a href={`sms:${phone}`} className={cn("p-4 rounded-full shadow-sm", color)}>
          <MessageSquare size={20} />
        </a>
      </div>
    </div>
  );
}

function CalendarSection({ date, eventInfo }: { date: Date; eventInfo: EventInfo }) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-brand-accent/30" />
        <h2 className="text-xs uppercase tracking-widest text-brand-primary font-semibold">Calendar</h2>
        <div className="h-px flex-1 bg-brand-accent/30" />
      </div>
      <div className="bg-brand-paper/50 p-6 rounded-3xl border border-brand-accent/10">
        <div className="text-center mb-6">
          <span className="text-4xl font-display text-brand-primary opacity-20 absolute left-8 -mt-2">
            0{format(date, 'M')}
          </span>
          <h3 className="text-lg font-outfit uppercase tracking-[0.2em]">{format(date, 'MMMM', { locale: ko })}</h3>
        </div>
        
        <div className="grid grid-cols-7 gap-1 text-[10px] text-center mb-2 font-medium opacity-40">
          {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {Array.from({ length: monthStart.getDay() }).map((_, i) => <div key={`e-${i}`} />)}
          {days.map(d => {
            const isEvent = isSameDay(d, date);
            return (
              <div 
                key={d.toISOString()} 
                className={cn(
                  "aspect-square flex items-center justify-center rounded-full transition-colors relative",
                  isEvent ? "bg-brand-primary text-white font-bold" : "text-slate-600"
                )}
              >
                {format(d, 'd')}
                {isEvent && (
                  <motion.div 
                    layoutId="event-highlight"
                    className="absolute -bottom-1 w-1 h-1 bg-brand-primary rounded-full"
                  />
                )}
              </div>
            );
          })}
        </div>
        
        <div className="mt-8">
           <button 
             onClick={() => {
               const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventInfo.babyName + ' 첫돌')}&dates=${format(date, 'yyyyMMdd')}/${format(date, 'yyyyMMdd')}&location=${encodeURIComponent(eventInfo.locationName)}&details=${encodeURIComponent('소중한 ' + eventInfo.babyName + '의 첫 생일에 초대합니다.')}`;
               window.open(googleUrl, '_blank');
             }}
             className="w-full py-3 bg-white text-brand-primary border border-brand-accent/30 rounded-xl text-xs font-medium tracking-wide flex items-center justify-center gap-2 shadow-sm"
           >
             <Calendar size={14} />
             구글 캘린더에 일정 등록하기
           </button>
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ eventInfo, setEventInfo, photos, onLogout }: { 
  eventInfo: EventInfo; 
  setEventInfo: (e: EventInfo) => void;
  photos: GalleryPhoto[];
  onLogout: () => void;
}) {
  const currentUserEmail = auth.currentUser?.email;
  const isAdmin = currentUserEmail === "sfooki86@gmail.com";

  const updateField = async (field: keyof EventInfo, value: string) => {
    const updated = { ...eventInfo, [field]: value };
    setEventInfo(updated);
    try {
      await setDoc(doc(db, 'config', 'main'), updated);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'config/main');
    }
  };

  const updateMainPhotos = async (idx: number, url: string) => {
    const fresh = [...eventInfo.mainPhotos];
    fresh[idx] = url;
    const updated = { ...eventInfo, mainPhotos: fresh };
    setEventInfo(updated);
    try {
      await setDoc(doc(db, 'config', 'main'), updated);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'config/main');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-[100] bg-white overflow-y-auto p-6 md:p-12 font-sans"
    >
      <div className="max-w-xl mx-auto space-y-10">
        <div className="flex justify-between items-center bg-slate-900 text-white p-6 rounded-3xl">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings size={20} /> Admin Panel
            </h2>
            <div className="flex flex-col">
              <p className="text-xs opacity-60">Manage your invitation data & album</p>
              {!isAdmin && (
                <p className="text-[9px] text-red-400 font-bold mt-1 uppercase tracking-tighter">
                  Warning: Logged in as {currentUserEmail}. Rules may deny changes.
                </p>
              )}
            </div>
          </div>
          <button onClick={onLogout} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full">Sign Out</button>
        </div>

        <div className="space-y-6">
          <SectionTitle>Gallery Management</SectionTitle>
          <div className="flex flex-col gap-4">
            <PhotoUpload />
            <div className="grid grid-cols-4 gap-2 mt-4">
              {photos.map(p => (
                <div key={p.id} className="relative group aspect-square bg-slate-100 rounded-lg overflow-hidden">
                  <img src={p.url} className="w-full h-full object-cover" alt="" />
                  <button 
                    onClick={async () => {
                      if(!p.id) return;
                      try {
                        await deleteDoc(doc(db, 'gallery', p.id));
                      } catch (e) {
                         handleFirestoreError(e, OperationType.DELETE, `gallery/${p.id}`);
                      }
                    }}
                    className="absolute inset-0 bg-red-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            {photos.length > 0 && (
              <button 
                onClick={async () => {
                  if (window.confirm("정말로 모든 사진을 삭제하시겠습니까?")) {
                    try {
                      const q = query(collection(db, 'gallery'));
                      const snap = await getDocs(q);
                      const batch = writeBatch(db);
                      snap.docs.forEach(d => batch.delete(d.ref));
                      await batch.commit();
                    } catch (e) {
                      handleFirestoreError(e, OperationType.DELETE, 'gallery');
                    }
                  }
                }}
                className="text-[10px] text-red-500 hover:underline text-right"
              >
                모든 사진 삭제 (Reset Gallery)
              </button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <SectionTitle>Basic Info</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Baby Name" value={eventInfo.babyName} onChange={v => updateField('babyName', v)} />
            <Field label="Baby Name (EN)" value={eventInfo.babyNameEn} onChange={v => updateField('babyNameEn', v)} />
            <Field label="Father" value={eventInfo.fatherName} onChange={v => updateField('fatherName', v)} />
            <Field label="Mother" value={eventInfo.motherName} onChange={v => updateField('motherName', v)} />
            <Field label="Brother (Optional)" value={eventInfo.brotherName || ''} onChange={v => updateField('brotherName', v)} />
          </div>
          <Field label="BGM URL (MP3)" value={eventInfo.bgmUrl || ''} onChange={v => updateField('bgmUrl', v)} />
          <Field label="Event Date (ISO)" value={eventInfo.eventDate} onChange={v => updateField('eventDate', v)} placeholder="2025-09-27T12:00:00" />
          <Field label="Location Name" value={eventInfo.locationName} onChange={v => updateField('locationName', v)} />
          <Field label="Address" value={eventInfo.address} onChange={v => updateField('address', v)} />
          <Field label="Naver Map URL" value={eventInfo.naverMapUrl} onChange={v => updateField('naverMapUrl', v)} />
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Greeting Text</label>
            <textarea 
              value={eventInfo.greetingText} 
              onChange={e => updateField('greetingText', e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none"
              rows={4}
            />
          </div>
        </div>

        <div className="space-y-6">
          <SectionTitle>Landing Page Photos</SectionTitle>
          <div className="space-y-3">
             {eventInfo.mainPhotos.map((url, i) => (
               <div key={i} className="flex gap-2 items-center">
                 <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0 group relative">
                    <img src={url} className="w-full h-full object-cover" alt="" />
                    <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                       <ImagePlus size={16} className="text-white" />
                       <input 
                         type="file" 
                         className="hidden" 
                         accept="image/*"
                         onChange={async (e) => {
                           const file = e.target.files?.[0];
                           if (file) {
                             try {
                               const compressed = await compressImage(file);
                               updateMainPhotos(i, compressed);
                             } catch (err) {
                               console.error("Compression failed", err);
                             }
                           }
                         }}
                       />
                    </label>
                 </div>
                 <input 
                   type="text" 
                   value={url} 
                   onChange={e => updateMainPhotos(i, e.target.value)}
                   className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-2 text-[10px] focus:ring-1 focus:ring-brand-primary outline-none"
                   placeholder={`Photo URL ${i+1}`}
                 />
               </div>
             ))}
          </div>
          <p className="text-[10px] text-slate-400 italic font-light">
            * 메인 사진은 상하/좌우 비율에 맞춰 압축하여 업로드됩니다.
          </p>
        </div>

        <div className="pt-10">
          <p className="text-center text-slate-300 text-xs italic">Changes are saved automatically to Firestore.</p>
        </div>
      </div>
    </motion.div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
      <ArrowRight size={12} className="text-brand-primary" /> {children}
    </h3>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{label}</label>
      <input 
        type="text" 
        value={value} 
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none"
      />
    </div>
  );
}

function PhotoUpload() {
  const [url, setUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const compressed = await compressImage(file);
      await addDoc(collection(db, 'gallery'), {
        url: compressed,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'gallery');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setIsUploading(true);
    try {
      await addDoc(collection(db, 'gallery'), {
        url,
        createdAt: serverTimestamp()
      });
      setUrl('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'gallery');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button 
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 bg-brand-primary text-white p-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-50"
        >
          {isUploading ? "업로드 중..." : "파일 선택하여 업로드"}
          <ImagePlus size={18} />
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*"
          onChange={handleFileChange}
        />
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-100" />
        </div>
        <div className="relative flex justify-center text-[10px] uppercase">
          <span className="bg-white px-2 text-slate-400">or use URL</span>
        </div>
      </div>

      <form onSubmit={handleUpload} className="flex gap-2">
        <input 
          type="text" 
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Photo URL to add"
          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none"
        />
        <button 
          type="submit"
          disabled={isUploading || !url}
          className="bg-slate-900 text-white p-3 rounded-xl disabled:opacity-50"
        >
          <ArrowRight size={20} />
        </button>
      </form>
    </div>
  );
}
