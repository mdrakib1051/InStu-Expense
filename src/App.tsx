/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  doc, 
  orderBy, 
  limit, 
  setDoc,
  updateDoc,
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { 
  Plus, 
  LogOut, 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Camera, 
  X, 
  History,
  PieChart,
  User as UserIcon,
  Home,
  CreditCard,
  Bell,
  Search,
  MoreHorizontal,
  ChevronRight,
  Settings,
  ShieldCheck,
  Lock,
  MessageSquare,
  AlertCircle,
  Clock,
  LayoutGrid,
  Edit2,
  Trash2,
  Calendar,
  BarChart2,
  StickyNote,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import imageCompression from 'browser-image-compression';
import { cn } from './lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

// Types
interface Transaction {
  id: string;
  amount: number;
  category: string;
  date: string;
  note: string;
  status: 'Paid' | 'Unpaid';
  type: 'Income' | 'Expense' | 'Lent' | 'Borrowed';
  receiptUrl?: string;
  userId: string;
}

interface UserProfile {
  email: string;
  displayName: string;
  photoURL: string;
  monthlyBudget: number;
}

interface Note {
  id: string;
  title: string;
  content: string;
  date: string;
  userId: string;
  isImportant: boolean;
  type: 'general' | 'debt' | 'reminder';
}

// Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection successful");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'stats' | 'notes' | 'cards' | 'profile'>('home');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (!u) {
        setTransactions([]);
        setProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  // Profile Listener
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          email: user.email || '',
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          monthlyBudget: 10000,
        };
        setDoc(doc(db, 'users', user.uid), newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

    return unsubscribe;
  }, [user]);

  // Transactions Listener
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return unsubscribe;
  }, [user, isAuthReady]);

  // Notes Listener
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(
      collection(db, 'notes'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(ns);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notes');
    });

    return unsubscribe;
  }, [user, isAuthReady]);

  const statsData = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let moneyIOWE = 0;
    let moneyOthersOWE = 0;

    const now = new Date();
    const startOfThisWeek = startOfWeek(now);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfFortnight = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    let weeklyExpense = 0;
    let fortnightlyExpense = 0;
    let monthlyExpense = 0;

    transactions.forEach(tx => {
      const txDate = new Date(tx.date);
      if (tx.type === 'Income') totalIncome += tx.amount;
      if (tx.type === 'Expense') {
        totalExpense += tx.amount;
        if (txDate >= startOfThisWeek) weeklyExpense += tx.amount;
        if (txDate >= startOfFortnight) fortnightlyExpense += tx.amount;
        if (txDate >= startOfThisMonth) monthlyExpense += tx.amount;
      }
      if (tx.type === 'Borrowed' && tx.status === 'Unpaid') moneyIOWE += tx.amount;
      if (tx.type === 'Lent' && tx.status === 'Unpaid') moneyOthersOWE += tx.amount;
    });

    // Weekly Chart Data
    const start = startOfWeek(new Date());
    const end = endOfWeek(new Date());
    const days = eachDayOfInterval({ start, end });

    const chartData = days.map(day => {
      const dayIncome = transactions
        .filter(tx => tx.type === 'Income' && isSameDay(new Date(tx.date), day))
        .reduce((sum, tx) => sum + tx.amount, 0);
      const dayExpense = transactions
        .filter(tx => tx.type === 'Expense' && isSameDay(new Date(tx.date), day))
        .reduce((sum, tx) => sum + tx.amount, 0);
      
      return {
        name: format(day, 'EEE'),
        income: dayIncome,
        expense: dayExpense
      };
    });

    return {
      balance: totalIncome - totalExpense,
      totalIncome,
      totalExpense,
      moneyIOWE,
      moneyOthersOWE,
      chartData,
      weeklyExpense,
      fortnightlyExpense,
      monthlyExpense,
      currentMonthExpense: monthlyExpense
    };
  }, [transactions]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login Error:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  if (!isAuthReady) return <LoadingScreen />;
  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white pb-24 overflow-x-hidden">
      {/* Dynamic Content Based on Tab */}
      <AnimatePresence mode="wait">
        {activeTab === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="p-6 space-y-8"
          >
            {/* Top Bar */}
            <div className="flex justify-between items-center">
              <button className="p-2 glass rounded-xl btn-haptic">
                <LayoutGrid size={24} />
              </button>
              <h1 className="text-lg font-bold">Home</h1>
              <button className="p-2 glass rounded-xl btn-haptic relative">
                <Bell size={24} />
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0a0a0a]"></span>
              </button>
            </div>

            {/* Total Balance Card - Premium Editorial Style */}
            <div className="relative pt-4">
              <div className="absolute -top-12 -right-12 w-64 h-64 bg-indigo-600/20 rounded-full blur-[100px]"></div>
              <div className="absolute -bottom-12 -left-12 w-64 h-64 bg-pink-600/20 rounded-full blur-[100px]"></div>
              
              <div className="space-y-1 mb-8">
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold ml-1">Available Balance</p>
                <h2 className="text-6xl font-bold tracking-tighter font-display leading-none">
                  ${statsData.balance.toLocaleString()}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card !p-6 bg-white/[0.02] border-white/5 space-y-4">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <ArrowDownLeft size={20} className="text-green-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Income</p>
                    <p className="text-xl font-bold font-display">${statsData.totalIncome.toLocaleString()}</p>
                  </div>
                </div>
                <div className="glass-card !p-6 bg-white/[0.02] border-white/5 space-y-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <ArrowUpRight size={20} className="text-red-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Expenses</p>
                    <p className="text-xl font-bold font-display">${statsData.totalExpense.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold font-display tracking-tight">Transactions</h3>
                <button className="text-indigo-400 text-sm font-medium">See All</button>
              </div>
              <div className="space-y-4">
                {transactions.length === 0 ? (
                  <div className="text-center py-12 text-white/20">
                    <History size={48} className="mx-auto mb-2 opacity-20" />
                    <p>No transactions yet</p>
                  </div>
                ) : (
                  transactions.slice(0, 5).map((tx) => (
                    <div key={tx.id}>
                      <TransactionItem tx={tx} onEdit={() => setEditingTx(tx)} />
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Quick Notes Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold font-display tracking-tight">Quick Notes</h3>
                <button 
                  onClick={() => setIsAddingNote(true)}
                  className="text-indigo-400 text-sm font-medium flex items-center gap-1"
                >
                  <Plus size={16} /> Add
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {notes.length === 0 ? (
                  <div className="col-span-2 glass-card !p-8 text-center text-white/20">
                    <StickyNote size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-xs">No important notes yet</p>
                  </div>
                ) : (
                  notes.slice(0, 4).map((note) => (
                    <div key={note.id} onClick={() => setEditingNote(note)}>
                      <NoteCard note={note} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'stats' && (
          <motion.div 
            key="stats"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="p-6 space-y-8"
          >
            <div className="flex justify-between items-center">
              <button className="p-2 glass rounded-xl btn-haptic">
                <LayoutGrid size={24} />
              </button>
              <h1 className="text-lg font-bold font-display tracking-tight">Overview</h1>
              <div className="w-10"></div>
            </div>

            {/* Stat Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-card !p-5 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Total Income</p>
                <p className="text-xl font-bold text-indigo-400 font-display">${statsData.totalIncome.toLocaleString()}</p>
              </div>
              <div className="glass-card !p-5 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Total Expenses</p>
                <p className="text-xl font-bold text-pink-400 font-display">${statsData.totalExpense.toLocaleString()}</p>
              </div>
            </div>

            {/* Reports Section */}
            <div className="space-y-4">
              <h3 className="font-bold text-lg font-display tracking-tight flex items-center gap-2">
                <BarChart2 size={20} className="text-indigo-400" />
                Spending Reports
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-card !p-4 bg-white/[0.02] border-white/5 text-center space-y-1">
                  <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Weekly</p>
                  <p className="text-sm font-bold font-display">${statsData.weeklyExpense.toLocaleString()}</p>
                </div>
                <div className="glass-card !p-4 bg-white/[0.02] border-white/5 text-center space-y-1">
                  <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Fortnightly</p>
                  <p className="text-sm font-bold font-display">${statsData.fortnightlyExpense.toLocaleString()}</p>
                </div>
                <div className="glass-card !p-4 bg-white/[0.02] border-white/5 text-center space-y-1">
                  <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Monthly</p>
                  <p className="text-sm font-bold font-display">${statsData.monthlyExpense.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="glass-card !p-6 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">Statistics</h3>
                <select className="bg-transparent text-xs font-medium focus:outline-none">
                  <option className="bg-[#0a0a0a]">Monthly</option>
                  <option className="bg-[#0a0a0a]">Weekly</option>
                </select>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} 
                    />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ background: 'rgba(10,10,10,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ fontSize: '12px' }}
                    />
                    <Bar dataKey="income" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={12} />
                    <Bar dataKey="expense" fill="#ec4899" radius={[4, 4, 0, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Income vs Expense Tabs */}
            <div className="flex p-1 glass rounded-2xl">
              <button className="flex-1 py-3 text-sm font-bold bg-white/10 rounded-xl">Income</button>
              <button className="flex-1 py-3 text-sm font-bold text-white/40">Expenses</button>
            </div>

            {/* List of transactions for stats */}
            <div className="space-y-4">
              {transactions.slice(0, 3).map(tx => (
                <div key={tx.id}>
                  <TransactionItem tx={tx} onEdit={() => setEditingTx(tx)} />
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'notes' && (
          <motion.div 
            key="notes"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="p-6 space-y-8 pb-32"
          >
            <div className="flex justify-between items-center">
              <button className="p-2 glass rounded-xl btn-haptic">
                <StickyNote size={24} />
              </button>
              <h1 className="text-lg font-bold font-display tracking-tight">My Notes</h1>
              <button 
                onClick={() => setIsAddingNote(true)}
                className="p-2 glass rounded-xl btn-haptic text-indigo-400"
              >
                <Plus size={24} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {notes.length === 0 ? (
                <div className="col-span-2 text-center py-20 text-white/20">
                  <StickyNote size={64} className="mx-auto mb-4 opacity-10" />
                  <p className="font-medium">No notes yet</p>
                  <p className="text-xs mt-1">Add important reminders or debt tracking</p>
                </div>
              ) : (
                notes.map((note) => (
                  <div key={note.id} onClick={() => setEditingNote(note)}>
                    <NoteCard note={note} />
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'cards' && (
          <motion.div 
            key="cards"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="p-6 space-y-8"
          >
            <div className="flex justify-between items-center">
              <button className="p-2 glass rounded-xl btn-haptic">
                <LayoutGrid size={24} />
              </button>
              <h1 className="text-lg font-bold font-display tracking-tight">My Card</h1>
              <button className="p-2 glass rounded-xl btn-haptic">
                <Plus size={24} />
              </button>
            </div>

            {/* Visual Card */}
            <div className="aspect-[1.6/1] w-full rounded-[32px] bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl"></div>
              <div className="flex justify-between items-start">
                <div className="w-12 h-8 bg-white/20 rounded-md backdrop-blur-md border border-white/30"></div>
                <div className="text-right">
                  <p className="text-[10px] text-white/70 uppercase tracking-widest font-bold">Current Balance</p>
                  <p className="text-2xl font-bold font-display">${statsData.balance.toLocaleString()}</p>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-xl font-mono tracking-[0.2em] text-white/90">4836 7489 4562 1258</p>
                <div className="flex justify-between items-end">
                  <p className="text-sm font-medium text-white/80">{user.displayName}</p>
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-red-500/80 backdrop-blur-sm"></div>
                    <div className="w-8 h-8 rounded-full bg-yellow-500/80 backdrop-blur-sm"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Details Section */}
            <div className="space-y-4">
              <h3 className="font-bold text-lg">Card Details</h3>
              <div className="glass-card !p-0 overflow-hidden">
                <div className="p-5 border-b border-white/5 flex justify-between items-center">
                  <span className="text-white/50 text-sm">Card Holder</span>
                  <span className="font-bold">{user.displayName}</span>
                </div>
                <div className="p-5 border-b border-white/5 flex justify-between items-center">
                  <span className="text-white/50 text-sm">Expiry Date</span>
                  <span className="font-bold">08/28</span>
                </div>
                <div className="p-5 flex justify-between items-center">
                  <span className="text-white/50 text-sm">CVV</span>
                  <span className="font-bold">***</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'profile' && (
          <motion.div 
            key="profile"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="p-6 space-y-8"
          >
            <div className="flex justify-center flex-col items-center space-y-4 pt-8">
              <div className="relative">
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-indigo-500/30 p-1">
                  <img src={user.photoURL || ''} alt="Profile" className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <button className="absolute bottom-0 right-0 p-2 bg-indigo-600 rounded-full border-4 border-[#0a0a0a] btn-haptic">
                  <Camera size={16} />
                </button>
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold">{user.displayName}</h2>
                <p className="text-white/40 text-sm">{user.email}</p>
              </div>
            </div>

            {/* Profile Menu */}
            <div className="space-y-4">
              <ProfileMenuItem icon={UserIcon} label="Account Info" color="text-indigo-400" />
              <ProfileMenuItem icon={ShieldCheck} label="Security Code" color="text-green-400" />
              <ProfileMenuItem icon={Lock} label="Privacy Policy" color="text-blue-400" />
              <ProfileMenuItem icon={Settings} label="Settings" color="text-purple-400" />
              <ProfileMenuItem icon={LogOut} label="Logout" color="text-red-400" onClick={handleLogout} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 glass h-20 flex items-center justify-around px-2 z-40 border-t border-white/5">
        <NavButton active={activeTab === 'home'} icon={Home} label="Home" onClick={() => setActiveTab('home')} />
        <NavButton active={activeTab === 'stats'} icon={PieChart} label="Stats" onClick={() => setActiveTab('stats')} />
        
        <div className="relative flex flex-col items-center mt-auto pb-2">
          <button 
            onClick={() => setActiveTab('notes')}
            className={cn(
              "p-2 rounded-xl transition-all duration-300",
              activeTab === 'notes' ? "text-indigo-400 bg-indigo-400/10" : "text-white/30"
            )}
          >
            <StickyNote size={20} />
          </button>
          <span className={cn("text-[7px] font-bold uppercase tracking-widest -mt-1", activeTab === 'notes' ? "text-indigo-400" : "text-white/20")}>Notes</span>
        </div>

        <NavButton active={activeTab === 'cards'} icon={CreditCard} label="Cards" onClick={() => setActiveTab('cards')} />
        <NavButton active={activeTab === 'profile'} icon={UserIcon} label="Profile" onClick={() => setActiveTab('profile')} />
        
        {/* Floating Action Button */}
        <button 
          onClick={() => setIsAdding(true)}
          className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-indigo-600 shadow-xl shadow-indigo-600/40 flex items-center justify-center btn-haptic z-50"
        >
          <Plus size={32} />
        </button>
      </nav>

      {/* Add Transaction Modal */}
      <AnimatePresence>
        {isAdding && (
          <AddTransactionModal 
            onClose={() => setIsAdding(false)} 
            userId={user.uid} 
          />
        )}
      </AnimatePresence>

      {/* Edit Transaction Modal */}
      <AnimatePresence>
        {editingTx && (
          <EditTransactionModal 
            tx={editingTx}
            onClose={() => setEditingTx(null)} 
            userId={user.uid} 
          />
        )}
      </AnimatePresence>

      {/* Add Note Modal */}
      <AnimatePresence>
        {isAddingNote && (
          <AddNoteModal 
            onClose={() => setIsAddingNote(false)} 
            userId={user.uid} 
          />
        )}
      </AnimatePresence>

      {/* Edit Note Modal */}
      <AnimatePresence>
        {editingNote && (
          <EditNoteModal 
            note={editingNote}
            onClose={() => setEditingNote(null)} 
            userId={user.uid} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, icon: Icon, label, onClick }: { active: boolean, icon: any, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-1 group"
    >
      <div className={cn(
        "p-2 rounded-xl transition-all duration-300",
        active ? "text-indigo-400 bg-indigo-400/10" : "text-white/30 group-hover:text-white/50"
      )}>
        <Icon size={20} />
      </div>
      <span className={cn(
        "text-[7px] font-bold uppercase tracking-widest transition-all duration-300",
        active ? "text-indigo-400" : "text-white/20 group-hover:text-white/40"
      )}>
        {label}
      </span>
    </button>
  );
}

const NoteCard = ({ note }: { note: Note }) => (
  <div className={`glass-card !p-4 space-y-3 relative overflow-hidden group transition-all active:scale-95 cursor-pointer ${note.isImportant ? 'border-indigo-500/30' : 'border-white/5'}`}>
    {note.isImportant && (
      <div className="absolute top-0 right-0 p-2">
        <Star size={12} className="text-indigo-400 fill-indigo-400" />
      </div>
    )}
    <div className="space-y-1">
      <h4 className="font-bold text-sm font-display tracking-tight line-clamp-1">{note.title}</h4>
      <p className="text-[10px] text-white/50 line-clamp-2 leading-relaxed">{note.content}</p>
    </div>
    <div className="flex justify-between items-center pt-2 border-t border-white/5">
      <span className={`text-[7px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${
        note.type === 'debt' ? 'bg-red-500/10 text-red-400' : 
        note.type === 'reminder' ? 'bg-indigo-500/10 text-indigo-400' : 
        'bg-white/5 text-white/40'
      }`}>
        {note.type}
      </span>
      <span className="text-[7px] text-white/30 font-medium">{new Date(note.date).toLocaleDateString()}</span>
    </div>
  </div>
);

function ProfileMenuItem({ icon: Icon, label, color, onClick }: { icon: any, label: string, color: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full glass-card !p-5 flex items-center justify-between btn-haptic"
    >
      <div className="flex items-center gap-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-white/5", color)}>
          <Icon size={20} />
        </div>
        <span className="font-bold">{label}</span>
      </div>
      <ChevronRight size={20} className="text-white/20" />
    </button>
  );
}

function AddNoteModal({ onClose, userId }: { onClose: () => void, userId: string }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'general' | 'debt' | 'reminder'>('general');
  const [isImportant, setIsImportant] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) return;

    setLoading(true);
    try {
      const noteData = {
        title,
        content,
        type,
        isImportant,
        userId,
        date: new Date().toISOString()
      };

      await addDoc(collection(db, 'notes'), noteData);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        className="relative w-full max-w-md glass-card !p-8 space-y-6 overflow-hidden"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold font-display tracking-tight">Add New Note</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Title</label>
            <input 
              required
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Content</label>
            <textarea 
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your note here..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-indigo-500/50 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(['general', 'debt', 'reminder'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-all ${
                  type === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-white/40'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between p-4 glass rounded-2xl">
            <div className="flex items-center gap-3">
              <Star size={20} className={isImportant ? 'text-indigo-400 fill-indigo-400' : 'text-white/20'} />
              <span className="text-sm font-medium">Mark as Important</span>
            </div>
            <button 
              type="button"
              onClick={() => setIsImportant(!isImportant)}
              className={`w-12 h-6 rounded-full transition-colors relative ${isImportant ? 'bg-indigo-600' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isImportant ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          <button 
            disabled={loading}
            type="submit"
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-2xl font-bold tracking-wide shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]"
          >
            {loading ? 'Creating...' : 'Create Note'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function EditNoteModal({ note, onClose, userId }: { note: Note, onClose: () => void, userId: string }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [type, setType] = useState(note.type);
  const [isImportant, setIsImportant] = useState(note.isImportant);
  const [loading, setLoading] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateDoc(doc(db, 'notes', note.id), {
        title,
        content,
        type,
        isImportant
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'notes', note.id));
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `notes/${note.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        className="relative w-full max-w-md glass-card !p-8 space-y-6 overflow-hidden"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold font-display tracking-tight">Edit Note</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleDelete} className="p-2 hover:bg-red-500/10 text-red-400 rounded-full transition-colors">
              <Trash2 size={20} />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>

        <form onSubmit={handleUpdate} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Title</label>
            <input 
              required
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Content</label>
            <textarea 
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-indigo-500/50 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(['general', 'debt', 'reminder'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-all ${
                  type === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-white/40'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between p-4 glass rounded-2xl">
            <div className="flex items-center gap-3">
              <Star size={20} className={isImportant ? 'text-indigo-400 fill-indigo-400' : 'text-white/20'} />
              <span className="text-sm font-medium">Mark as Important</span>
            </div>
            <button 
              type="button"
              onClick={() => setIsImportant(!isImportant)}
              className={`w-12 h-6 rounded-full transition-colors relative ${isImportant ? 'bg-indigo-600' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isImportant ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          <button 
            disabled={loading}
            type="submit"
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-2xl font-bold tracking-wide shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]"
          >
            {loading ? 'Updating...' : 'Save Changes'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function TransactionItem({ tx, onEdit }: { tx: Transaction, onEdit?: () => void }) {
  const isPositive = tx.type === 'Income' || tx.type === 'Borrowed';
  
  // Custom icons based on category
  const getIcon = () => {
    const cat = tx.category.toLowerCase();
    const note = tx.note?.toLowerCase() || '';
    
    // Automatic Logo Detection
    if (cat.includes('uber') || note.includes('uber')) return <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center font-bold text-white font-display">U</div>;
    if (cat.includes('paypal') || note.includes('paypal')) return <div className="w-10 h-10 bg-[#003087] rounded-xl flex items-center justify-center font-bold text-white font-display">P</div>;
    if (cat.includes('netflix') || note.includes('netflix')) return <div className="w-10 h-10 bg-[#E50914] rounded-xl flex items-center justify-center font-bold text-white font-display">N</div>;
    if (cat.includes('spotify') || note.includes('spotify')) return <div className="w-10 h-10 bg-[#1DB954] rounded-xl flex items-center justify-center font-bold text-white font-display">S</div>;
    if (cat.includes('apple') || note.includes('apple')) return <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center font-bold text-white font-display">A</div>;
    if (cat.includes('amazon') || note.includes('amazon')) return <div className="w-10 h-10 bg-[#FF9900] rounded-xl flex items-center justify-center font-bold text-black font-display">A</div>;
    if (cat.includes('starbucks') || note.includes('starbucks')) return <div className="w-10 h-10 bg-[#00704A] rounded-xl flex items-center justify-center font-bold text-white font-display">S</div>;
    if (cat.includes('mcdonald') || note.includes('mcdonald')) return <div className="w-10 h-10 bg-[#FFC72C] rounded-xl flex items-center justify-center font-bold text-red-600 font-display">M</div>;
    
    // Suggested Categories Logos
    if (cat.includes('salary')) return <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center font-bold text-white font-display">S</div>;
    if (cat.includes('food')) return <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center font-bold text-white font-display">F</div>;
    if (cat.includes('rent')) return <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-white font-display">R</div>;
    if (cat.includes('shopping')) return <div className="w-10 h-10 bg-pink-600 rounded-xl flex items-center justify-center font-bold text-white font-display">S</div>;
    if (cat.includes('travel')) return <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center font-bold text-white font-display">T</div>;
    if (cat.includes('health')) return <div className="w-10 h-10 bg-rose-600 rounded-xl flex items-center justify-center font-bold text-white font-display">H</div>;
    
    return isPositive ? <ArrowDownLeft size={24} className="text-green-400" /> : <ArrowUpRight size={24} className="text-red-400" />;
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card !p-4 flex items-center gap-4 hover:bg-white/5 transition-colors group relative"
    >
      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center overflow-hidden group-hover:scale-110 transition-transform">
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold truncate text-sm font-display">{tx.category}</h4>
        <p className="text-[10px] text-white/40 uppercase tracking-widest">{format(new Date(tx.date), 'hh:mm a')}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className={cn("font-bold text-sm font-display", isPositive ? "text-green-400" : "text-red-400")}>
            {isPositive ? '+' : '-'}${tx.amount.toLocaleString()}
          </p>
        </div>
        {onEdit && (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-2 glass rounded-lg opacity-0 group-hover:opacity-100 transition-opacity btn-haptic text-white/40 hover:text-white"
          >
            <Edit2 size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function EditTransactionModal({ tx, onClose, userId }: { tx: Transaction, onClose: () => void, userId: string }) {
  const [amount, setAmount] = useState(tx.amount.toString());
  const [category, setCategory] = useState(tx.category);
  const [type, setType] = useState<'Income' | 'Expense' | 'Lent' | 'Borrowed'>(tx.type);
  const [note, setNote] = useState(tx.note || '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;

    setUploading(true);
    setError(null);

    try {
      const updatedTx = {
        amount: Number(amount),
        category,
        type,
        note,
        date: tx.date // Keep original date
      };

      await updateDoc(doc(db, 'transactions', tx.id), updatedTx);
      onClose();
    } catch (err) {
      console.error('Update Transaction Error:', err);
      setError('Failed to update transaction.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    
    setUploading(true);
    try {
      await deleteDoc(doc(db, 'transactions', tx.id));
      onClose();
    } catch (err) {
      console.error('Delete Transaction Error:', err);
      setError('Failed to delete transaction.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="w-full max-w-lg glass-card !rounded-t-[40px] sm:!rounded-[40px] !p-8 space-y-8 max-h-[95vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <button onClick={onClose} className="p-2 glass rounded-xl"><X size={20} /></button>
          <h2 className="text-xl font-bold font-display">Edit Transaction</h2>
          <button onClick={handleDelete} className="p-2 glass rounded-xl text-red-400"><Trash2 size={20} /></button>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Amount</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-glass w-full text-4xl font-bold font-display"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Category</label>
              <input 
                type="text" 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input-glass w-full"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Note</label>
              <textarea 
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="input-glass w-full resize-none h-24"
                placeholder="Add a note..."
              />
            </div>
          </div>

          <button 
            disabled={uploading}
            className="w-full py-5 rounded-2xl font-bold text-lg shadow-xl btn-haptic bg-indigo-600 disabled:opacity-50"
          >
            {uploading ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddTransactionModal({ onClose, userId }: { onClose: () => void, userId: string }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState<'Income' | 'Expense'>('Expense');
  const [note, setNote] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1280, useWebWorker: true };
        const compressedFile = await imageCompression(file, options);
        setImage(compressedFile);
        setPreview(URL.createObjectURL(compressedFile));
      } catch (error) {
        console.error('Compression Error:', error);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;

    setUploading(true);
    setError(null);
    let receiptUrl = '';

    try {
      console.log('Submitting transaction...', { amount, category, type, userId });
      if (image) {
        const storageRef = ref(storage, `receipts/${userId}/${Date.now()}_${image.name}`);
        await uploadBytes(storageRef, image);
        receiptUrl = await getDownloadURL(storageRef);
      }

      const tx: Omit<Transaction, 'id'> = {
        amount: Number(amount),
        category,
        type: type as any,
        status: 'Paid',
        note,
        receiptUrl,
        date: new Date().toISOString(),
        userId
      };

      const docRef = await addDoc(collection(db, 'transactions'), tx);
      console.log('Transaction added with ID:', docRef.id);
      onClose();
    } catch (err) {
      console.error('Add Transaction Error:', err);
      setError('Failed to add transaction. Please check your connection or permissions.');
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="w-full max-w-lg glass-card !rounded-t-[40px] sm:!rounded-[40px] !p-8 space-y-8 max-h-[95vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <button onClick={onClose} className="p-2 glass rounded-xl"><X size={20} /></button>
          <h2 className="text-xl font-bold font-display">New Transaction</h2>
          <div className="w-10"></div>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* Add Income / Add Expense Toggle */}
        <div className="flex p-1 glass rounded-2xl">
          <button 
            type="button"
            onClick={() => setType('Income')}
            className={cn(
              "flex-1 py-4 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2",
              type === 'Income' ? "bg-indigo-600 text-white shadow-lg" : "text-white/40"
            )}
          >
            <ArrowDownLeft size={18} /> Add Income
          </button>
          <button 
            type="button"
            onClick={() => setType('Expense')}
            className={cn(
              "flex-1 py-4 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2",
              type === 'Expense' ? "bg-pink-600 text-white shadow-lg" : "text-white/40"
            )}
          >
            <ArrowUpRight size={18} /> Add Expense
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Amount</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="$0.00"
                className="input-glass w-full text-4xl font-bold placeholder:text-white/10 font-display"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Category</label>
              <input 
                type="text" 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Salary, Shopping, Food"
                className="input-glass w-full"
                required
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {['Salary', 'Food', 'Rent', 'Shopping', 'Travel', 'Health'].map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[10px] font-bold transition-all",
                      category === cat ? "bg-white/20 text-white" : "bg-white/5 text-white/40 hover:bg-white/10"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/40 ml-1 uppercase tracking-widest font-bold">Receipt</label>
              <label className="w-full h-32 glass rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed border-white/10 hover:border-indigo-500/50 transition-all overflow-hidden">
                {preview ? (
                  <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Camera className="text-white/20" size={32} />
                    <span className="text-xs text-white/20">Take a photo of receipt</span>
                  </>
                )}
                <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
          </div>

          <button 
            disabled={uploading}
            className={cn(
              "w-full py-5 rounded-2xl font-bold text-lg shadow-xl btn-haptic disabled:opacity-50",
              type === 'Income' ? "bg-indigo-600 shadow-indigo-600/30" : "bg-pink-600 shadow-pink-600/30"
            )}
          >
            {uploading ? "Processing..." : `Add ${type}`}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-[#050505] relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] -mr-64 -mt-64"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-pink-600/10 rounded-full blur-[120px] -ml-64 -mb-64"></div>
      
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="space-y-12 relative z-10"
      >
        <div className="w-24 h-24 bg-white/5 backdrop-blur-xl rounded-[32px] flex items-center justify-center mx-auto border border-white/10 shadow-2xl">
          <Wallet size={48} className="text-indigo-500" />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-6xl font-bold tracking-tighter font-display">
            FinTrack<span className="text-indigo-500">.</span>
          </h1>
          <p className="text-white/40 max-w-[280px] mx-auto text-sm leading-relaxed">
            Premium financial tracking for the modern era. Experience glassmorphism at its finest.
          </p>
        </div>

        <button 
          onClick={onLogin}
          className="w-full max-w-xs py-5 bg-white text-black rounded-2xl flex items-center justify-center gap-3 font-bold btn-haptic hover:bg-white/90 transition-colors"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
          Get Started with Google
        </button>
      </motion.div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full"
      />
    </div>
  );
}
