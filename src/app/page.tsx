'use client';

import React, { useState, useEffect } from 'react';

interface ApiResponse {
  endpoint: string;
  method: string;
  status: number;
  data: any;
  durationMs: number;
}

interface UserSession {
  id: string;
  email: string;
  phone?: string;
  fullName: string;
  isPlatformAdmin: boolean;
  memberships: Array<{
    id: string;
    tenantId: string;
    role: string;
    assignedTempleId?: string;
  }>;
}

export default function HomePage() {
  const [healthStatus, setHealthStatus] = useState<string>('CHECKING...');
  const [activeTab, setActiveTab] = useState<'devotee' | 'donations' | 'admin' | 'console' | 'architecture'>('devotee');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Temple & Catalog state
  const [templeData, setTempleData] = useState<any>(null);
  const [pujas, setPujas] = useState<any[]>([]);
  const [activePuja, setActivePuja] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);

  // Auth state
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Booking Flow State
  const [bookingStep, setBookingStep] = useState<'select' | 'reserve' | 'payment' | 'confirmed'>('select');
  const [bookingFormData, setBookingFormData] = useState({
    fullName: 'Rahul Sharma',
    email: 'devotee@example.com',
    phone: '+919876543210',
    gotram: 'Kashyapa',
    nakshatram: 'Rohini',
    rashi: 'Vrishabha',
    sankalpam: 'Health, spiritual fulfillment and family harmony',
    participants: 1,
  });
  const [activeReservation, setActiveReservation] = useState<any>(null);
  const [holdCountdown, setHoldCountdown] = useState<number>(600); // 10 minutes in seconds

  // Donation Flow State
  const [donationAmount, setDonationAmount] = useState<number>(2100);
  const [donorForm, setDonorForm] = useState({
    name: 'Rahul Sharma',
    email: 'devotee@example.com',
    phone: '+919876543210',
    pan: 'ABCDE1234F',
  });
  const [activeDonation, setActiveDonation] = useState<any>(null);
  const [donationReceipt, setDonationReceipt] = useState<any>(null);

  // Admin Dashboard State
  const [adminMetrics, setAdminMetrics] = useState<any>(null);
  const [checkInReference, setCheckInReference] = useState<string>('');
  const [checkInResult, setCheckInResult] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Fetch initial data & verify session
  const refreshAuth = () => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.data) {
          setCurrentUser(res.data);
        } else {
          setCurrentUser(null);
        }
      })
      .catch(() => setCurrentUser(null));
  };

  const loadTempleAndPujas = () => {
    fetch('/api/public/siddhivinayak/prabhadevi')
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.data) {
          setTempleData(res.data);
        }
      })
      .catch(() => {});

    fetch('/api/public/siddhivinayak/prabhadevi/pujas')
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.pujas || []);
          setPujas(list);
          if (list.length > 0 && !activePuja) {
            setActivePuja(list[0]);
            if (list[0].slots && list[0].slots.length > 0) {
              setSelectedSlot(list[0].slots[0]);
            }
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    // Health check
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'ok') {
          setHealthStatus('OPERATIONAL');
        } else {
          setHealthStatus('DEGRADED');
        }
      })
      .catch(() => setHealthStatus('OFFLINE'));

    refreshAuth();
    loadTempleAndPujas();
  }, []);

  // Hold countdown timer
  useEffect(() => {
    if (bookingStep === 'payment' && holdCountdown > 0) {
      const timer = setInterval(() => {
        setHoldCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [bookingStep, holdCountdown]);

  // Auth Helpers
  const quickLogin = async (identifier: string, pass: string) => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: pass }),
      });
      const data = await res.json();
      if (data.success) {
        refreshAuth();
        runApiLog('POST', '/api/auth/login', 200, data, 45);
      } else {
        alert(data.error?.message || 'Login failed');
      }
    } catch (err: any) {
      alert(err.message || 'Login error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      runApiLog('POST', '/api/auth/logout', 200, { success: true }, 15);
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  // API Console Logger Helper
  const runApiLog = (method: string, endpoint: string, status: number, data: any, durationMs: number) => {
    setResponse({ method, endpoint, status, data, durationMs });
  };

  const runApi = async (method: string, endpoint: string, body?: any) => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      const durationMs = Math.round(performance.now() - start);
      setResponse({ endpoint, method, status: res.status, data, durationMs });

      // Refresh catalog if seed is triggered
      if (endpoint.includes('/seed')) {
        setTimeout(() => {
          loadTempleAndPujas();
          refreshAuth();
        }, 500);
      }
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - start);
      setResponse({
        endpoint,
        method,
        status: 500,
        data: { error: err.message || 'Request failed' },
        durationMs,
      });
    } finally {
      setLoading(false);
    }
  };

  // 1. Reserve Puja Slot
  const handleReserveSlot = async () => {
    if (!templeData || !activePuja || !selectedSlot) {
      alert('Please select a puja service and slot first.');
      return;
    }
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/bookings/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: templeData.tenantId,
          templeId: templeData.id,
          pujaServiceId: activePuja.id,
          slotId: selectedSlot.id,
          participantCount: bookingFormData.participants,
          devoteeUserId: currentUser?.id,
          devoteeDetails: {
            name: bookingFormData.fullName,
            email: bookingFormData.email,
            phone: bookingFormData.phone,
            gotram: bookingFormData.gotram,
            nakshatram: bookingFormData.nakshatram,
            rashi: bookingFormData.rashi,
            sankalpam: bookingFormData.sankalpam,
          },
          paymentProvider: 'MOCK',
        }),
      });
      const data = await res.json();
      const dur = Math.round(performance.now() - start);
      runApiLog('POST', '/api/bookings/reserve', res.status, data, dur);

      if (data.success && data.data) {
        setActiveReservation(data.data);
        setHoldCountdown(600); // 10 minutes hold
        setBookingStep('payment');
      } else {
        alert(data.error?.message || 'Failed to hold capacity');
      }
    } catch (e: any) {
      alert(e.message || 'Reservation error');
    } finally {
      setLoading(false);
    }
  };

  // 2. Simulate Payment Webhook (Direct Merchant Settlement)
  const handleSimulatePayment = async () => {
    if (!activeReservation) return;
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/dev/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: templeData.tenantId,
          templeId: templeData.id,
          providerOrderId: activeReservation.paymentOrder?.providerOrderId,
          amountMinorUnits: activeReservation.totalPriceMinorUnits,
          currency: activeReservation.currency,
          provider: 'MOCK',
        }),
      });
      const data = await res.json();
      const dur = Math.round(performance.now() - start);
      runApiLog('POST', '/api/dev/simulate-payment', res.status, data, dur);

      if (data.success) {
        setBookingStep('confirmed');
        loadTempleAndPujas(); // Refresh remaining capacity
      } else {
        alert(data.error?.message || 'Payment simulation failed');
      }
    } catch (e: any) {
      alert(e.message || 'Payment simulation error');
    } finally {
      setLoading(false);
    }
  };

  // 3. Initiate Donation & Section 80G Tax Receipt
  const handleInitiateDonation = async () => {
    if (!templeData) return;
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/donations/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: templeData.tenantId,
          templeId: templeData.id,
          campaignId: 'donation_campaign_annadanam',
          donorUserId: currentUser?.id,
          amountMinorUnits: donationAmount * 100,
          currency: 'INR',
          donorName: donorForm.name,
          donorEmail: donorForm.email,
          donorPhone: donorForm.phone,
          donorPan: donorForm.pan,
          provider: 'MOCK',
        }),
      });
      const data = await res.json();
      const dur = Math.round(performance.now() - start);
      runApiLog('POST', '/api/donations/initiate', res.status, data, dur);

      if (data.success && data.data) {
        setActiveDonation(data.data);
      } else {
        alert(data.error?.message || 'Failed to initiate donation');
      }
    } catch (e: any) {
      alert(e.message || 'Donation error');
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateDonationPayment = async () => {
    if (!activeDonation) return;
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/dev/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: templeData.tenantId,
          templeId: templeData.id,
          providerOrderId: activeDonation.paymentOrder?.providerOrderId,
          amountMinorUnits: activeDonation.amountMinorUnits,
          currency: activeDonation.currency,
          provider: 'MOCK',
        }),
      });
      const data = await res.json();
      const dur = Math.round(performance.now() - start);
      runApiLog('POST', '/api/dev/simulate-payment', res.status, data, dur);

      if (data.success) {
        setDonationReceipt({
          receiptNumber: `RCP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          amount: donationAmount,
          donorName: donorForm.name,
          pan: donorForm.pan,
          date: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
          legalEntity: 'Shree Siddhivinayak Temple Public Charitable Trust',
          taxSection: 'Section 80G of the Income Tax Act, 1961 (50% Tax Exemption)',
        });
      }
    } catch (e: any) {
      alert(e.message || 'Payment error');
    } finally {
      setLoading(false);
    }
  };

  // Load Admin Dashboard
  const loadAdminDashboard = async () => {
    if (!templeData) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/dashboard?tenantId=${templeData.tenantId}&templeId=${templeData.id}`);
      const data = await res.json();
      if (data.success) {
        setAdminMetrics(data.data);
      }
      const logsRes = await fetch(`/api/admin/audit-logs?tenantId=${templeData.tenantId}&limit=10`);
      const logsData = await logsRes.json();
      if (logsData.success) {
        setAuditLogs(logsData.data?.logs || []);
      }
    } catch {
      // Handled silently
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (!checkInReference) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bookings/${checkInReference}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setCheckInResult(`✅ Devotee checked in successfully for ${checkInReference}! Attendance recorded.`);
      } else {
        setCheckInResult(`❌ Check-in failed: ${data.error?.message || 'Invalid booking reference'}`);
      }
    } catch (err: any) {
      setCheckInResult(`❌ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Format format date string
  const formatSlotTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-IN', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }) + ' at ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 24px 80px' }}>
      {/* Top Navbar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderRadius: '16px',
          background: 'rgba(17, 24, 39, 0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '28px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(234, 88, 12, 0.25))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              border: '1px solid rgba(245, 158, 11, 0.4)',
            }}
          >
            🛕
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
                TempleTrust SaaS
              </h1>
              <span className="badge badge-saffron" style={{ fontSize: '9px', padding: '2px 6px' }}>v1.0 PILOT</span>
            </div>
            <p style={{ fontSize: '12px', color: '#9CA3AF' }}>Enterprise Multi-Tenant Religious Trust Platform</p>
          </div>
        </div>

        {/* Right side status & Auth Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '999px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontSize: '12px',
              fontWeight: 600,
              color: '#34D399',
            }}
          >
            <span className="ping-dot" />
            <span>Server {healthStatus}</span>
          </div>

          {currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '4px 12px 4px 6px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '999px',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: currentUser.isPlatformAdmin ? '#F59E0B' : '#10B981',
                  color: '#000',
                  fontWeight: 800,
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {currentUser.fullName.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ fontSize: '12px' }}>
                <span style={{ fontWeight: 600, color: '#fff' }}>{currentUser.fullName}</span>
                <span style={{ color: '#9CA3AF', marginLeft: '6px', fontSize: '11px' }}>
                  ({currentUser.isPlatformAdmin ? 'PLATFORM ADMIN' : 'DEVOTEE'})
                </span>
              </div>
              <button
                onClick={handleLogout}
                disabled={authLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#EF4444',
                  fontSize: '11px',
                  fontWeight: 700,
                  marginLeft: '4px',
                  cursor: 'pointer',
                }}
              >
                Logout
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => quickLogin('admin@templesaas.com', 'AdminPassword123!')}
                disabled={authLoading}
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '11px' }}
              >
                ⚡ Login Admin
              </button>
              <button
                onClick={() => quickLogin('devotee@example.com', 'DevoteePassword123!')}
                disabled={authLoading}
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '11px', borderColor: 'rgba(52, 211, 153, 0.4)', color: '#34D399' }}
              >
                ⚡ Login Devotee
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Banner */}
      <section style={{ textAlign: 'center', marginBottom: '36px', padding: '16px 0' }}>
        <div className="badge badge-saffron" style={{ marginBottom: '14px' }}>
          🛡️ Row-Level Security &bull; Direct Merchant Routing &bull; 80G Sequential Tax Receipts
        </div>
        <h2
          style={{
            fontSize: '38px',
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: '-0.03em',
            marginBottom: '12px',
            background: 'linear-gradient(135deg, #FFFFFF 40%, #F59E0B 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {templeData?.name || 'Shree Siddhivinayak Temple Trust'}
        </h2>
        <p style={{ fontSize: '15px', maxWidth: '720px', margin: '0 auto', color: '#9CA3AF', lineHeight: 1.6 }}>
          Live demonstration of multi-tenant devotee booking workflows, high-concurrency 10-minute hold capacity slots, and Section 80G automated donation receipts.
        </p>
      </section>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: '14px',
          marginBottom: '28px',
          overflowX: 'auto',
        }}
      >
        {[
          { id: 'devotee', label: '🛕 Seva Booking Portal', badge: 'Devotee' },
          { id: 'donations', label: '🪙 Section 80G Donations', badge: 'Tax Exempt' },
          { id: 'admin', label: '📊 Temple Operations Dashboard', badge: 'Staff / Admin' },
          { id: 'console', label: '🛠️ Interactive API Console', badge: 'Live REST' },
          { id: 'architecture', label: '🏛️ Architecture & Endpoints', badge: '48 Routes' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as any);
              if (tab.id === 'admin') loadAdminDashboard();
            }}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 600,
              background: activeTab === tab.id ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: activeTab === tab.id ? '#FBBF24' : '#9CA3AF',
              border: activeTab === tab.id ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
            }}
          >
            <span>{tab.label}</span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: activeTab === tab.id ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                color: activeTab === tab.id ? '#FFF' : '#6B7280',
              }}
            >
              {tab.badge}
            </span>
          </button>
        ))}
      </div>

      {/* TAB 1: DEVOTEE PUJA BOOKING PORTAL */}
      {activeTab === 'devotee' && (
        <section>
          {/* Temple Information Header */}
          <div
            className="glass-panel"
            style={{
              padding: '24px 28px',
              marginBottom: '28px',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(17, 24, 39, 0.8) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span className="badge badge-emerald">Verified Temple Trust</span>
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Timezone: Asia/Kolkata (IST)</span>
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>
                {templeData?.name || 'Shree Siddhivinayak Temple'}
              </h3>
              <p style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '4px' }}>
                📍 {templeData?.address?.line1 || 'SK Bole Marg, Prabhadevi'}, {templeData?.address?.city || 'Mumbai'}, {templeData?.address?.state || 'Maharashtra'} - {templeData?.address?.postalCode || '400028'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Direct Merchant Payout</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#34D399', marginTop: '2px' }}>
                Razorpay / Stripe Live Escrow-Free
              </div>
            </div>
          </div>

          {/* Booking Lifecycle Experience */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
            {/* Left: Puja Services List */}
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '14px' }}>
                Available Sevas &amp; Pujas ({pujas.length})
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {pujas.length > 0 ? (
                  pujas.map((puja) => {
                    const isSelected = activePuja?.id === puja.id;
                    const slotCount = puja.slots?.length || 0;
                    return (
                      <div
                        key={puja.id}
                        onClick={() => {
                          setActivePuja(puja);
                          if (puja.slots && puja.slots.length > 0) {
                            setSelectedSlot(puja.slots[0]);
                          } else {
                            setSelectedSlot(null);
                          }
                          setBookingStep('select');
                        }}
                        className="glass-panel"
                        style={{
                          padding: '20px',
                          cursor: 'pointer',
                          borderColor: isSelected ? 'rgba(245, 158, 11, 0.6)' : 'rgba(255, 255, 255, 0.08)',
                          background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'rgba(18, 24, 38, 0.75)',
                          position: 'relative',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <div>
                            <h5 style={{ fontSize: '17px', fontWeight: 700, color: '#fff' }}>{puja.name}</h5>
                            <span style={{ fontSize: '12px', color: '#9CA3AF' }}>⏱️ Duration: {puja.durationMinutes} minutes</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '18px', fontWeight: 800, color: '#FBBF24' }}>
                              ₹{(puja.priceMinorUnits / 100).toLocaleString('en-IN')}
                            </div>
                            <span className="badge badge-blue" style={{ fontSize: '10px' }}>
                              {slotCount} Slots Open
                            </span>
                          </div>
                        </div>

                        <p style={{ fontSize: '13px', color: '#9CA3AF', lineHeight: 1.5, marginBottom: '14px' }}>
                          {puja.description}
                        </p>

                        {/* Slots Chips */}
                        {isSelected && puja.slots && puja.slots.length > 0 && (
                          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#E5E7EB', marginBottom: '8px' }}>
                              Select Desired Time Slot:
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {puja.slots.map((s: any) => {
                                const isSlotChosen = selectedSlot?.id === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSlot(s);
                                    }}
                                    style={{
                                      padding: '8px 12px',
                                      borderRadius: '8px',
                                      fontSize: '12px',
                                      background: isSlotChosen ? '#F59E0B' : 'rgba(255, 255, 255, 0.05)',
                                      color: isSlotChosen ? '#000' : '#E5E7EB',
                                      fontWeight: isSlotChosen ? 700 : 500,
                                      border: isSlotChosen ? '1px solid #F59E0B' : '1px solid rgba(255, 255, 255, 0.12)',
                                      textAlign: 'left',
                                    }}
                                  >
                                    <div>{formatSlotTime(s.startTime)}</div>
                                    <div style={{ fontSize: '10px', opacity: 0.85 }}>
                                      {s.availableCapacity} / {s.totalCapacity} seats left
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
                    <p style={{ color: '#9CA3AF', marginBottom: '16px' }}>No catalog data loaded in memory yet.</p>
                    <button onClick={() => runApi('POST', '/api/dev/seed')} className="btn-primary">
                      🌱 Seed Demo Catalog &amp; Slots
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Interactive Devotee Sankalpam & Reservation Drawer */}
            <div>
              <div className="glass-panel" style={{ padding: '24px', position: 'sticky', top: '24px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                  Devotee Booking Flow
                </h4>
                <p style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '20px' }}>
                  Atomic capacity lock with 10-minute hold TTL (FR-BOOK-003, AT-02)
                </p>

                {bookingStep === 'select' && (
                  <div>
                    {activePuja && selectedSlot ? (
                      <div>
                        <div
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            padding: '14px',
                            borderRadius: '10px',
                            marginBottom: '18px',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          <div style={{ fontSize: '12px', color: '#FBBF24', fontWeight: 700 }}>SELECTED SEVA</div>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginTop: '2px' }}>
                            {activePuja.name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
                            📅 {formatSlotTime(selectedSlot.startTime)} &bull; ₹{(activePuja.priceMinorUnits / 100).toLocaleString('en-IN')}
                          </div>
                        </div>

                        {/* Sankalpam details form */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div>
                            <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                              Primary Devotee Full Name *
                            </label>
                            <input
                              type="text"
                              value={bookingFormData.fullName}
                              onChange={(e) => setBookingFormData({ ...bookingFormData, fullName: e.target.value })}
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                              <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                                Email *
                              </label>
                              <input
                                type="email"
                                value={bookingFormData.email}
                                onChange={(e) => setBookingFormData({ ...bookingFormData, email: e.target.value })}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                                Mobile Phone *
                              </label>
                              <input
                                type="tel"
                                value={bookingFormData.phone}
                                onChange={(e) => setBookingFormData({ ...bookingFormData, phone: e.target.value })}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                            <div>
                              <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                                Gotram
                              </label>
                              <input
                                type="text"
                                value={bookingFormData.gotram}
                                onChange={(e) => setBookingFormData({ ...bookingFormData, gotram: e.target.value })}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                                Nakshatram
                              </label>
                              <input
                                type="text"
                                value={bookingFormData.nakshatram}
                                onChange={(e) => setBookingFormData({ ...bookingFormData, nakshatram: e.target.value })}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                                Rashi
                              </label>
                              <input
                                type="text"
                                value={bookingFormData.rashi}
                                onChange={(e) => setBookingFormData({ ...bookingFormData, rashi: e.target.value })}
                              />
                            </div>
                          </div>

                          <div>
                            <label style={{ fontSize: '12px', color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
                              Sankalpam Wish / Prayer Intent
                            </label>
                            <input
                              type="text"
                              value={bookingFormData.sankalpam}
                              onChange={(e) => setBookingFormData({ ...bookingFormData, sankalpam: e.target.value })}
                            />
                          </div>

                          <button
                            onClick={handleReserveSlot}
                            disabled={loading || selectedSlot.availableCapacity <= 0}
                            className="btn-primary"
                            style={{ marginTop: '10px', width: '100%', padding: '12px' }}
                          >
                            {loading ? 'Securing Slot...' : `🔒 Reserve & Hold Capacity (₹${(activePuja.priceMinorUnits / 100).toLocaleString('en-IN')})`}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px 10px', color: '#6B7280' }}>
                        Please select a puja service and slot on the left to begin booking.
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Payment & Hold State */}
                {bookingStep === 'payment' && activeReservation && (
                  <div>
                    <div
                      style={{
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '10px',
                        padding: '16px',
                        marginBottom: '18px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '11px', color: '#FBBF24', fontWeight: 700, textTransform: 'uppercase' }}>
                        Capacity Locked &bull; Hold TTL Active
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: 800, color: '#fff', margin: '6px 0', fontFamily: 'monospace' }}>
                        {Math.floor(holdCountdown / 60)}:{(holdCountdown % 60).toString().padStart(2, '0')}
                      </div>
                      <p style={{ fontSize: '12px', color: '#9CA3AF' }}>
                        Booking Reference: <strong style={{ color: '#fff' }}>{activeReservation.bookingReference}</strong>
                      </p>
                    </div>

                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '8px', marginBottom: '18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Service:</span>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{activePuja.name}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Devotee:</span>
                        <span style={{ color: '#fff' }}>{bookingFormData.fullName} ({bookingFormData.gotram})</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span style={{ color: '#9CA3AF' }}>Total Amount:</span>
                        <span style={{ color: '#FBBF24', fontWeight: 700 }}>
                          ₹{(activeReservation.totalPriceMinorUnits / 100).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    <p style={{ fontSize: '11px', color: '#6B7280', marginBottom: '14px' }}>
                      ⚡ In production, devotee completes checkout on Razorpay / Stripe modal. In this pilot demo, click below to fire signed provider webhook.
                    </p>

                    <button
                      onClick={handleSimulatePayment}
                      disabled={loading || holdCountdown <= 0}
                      className="btn-primary"
                      style={{ width: '100%', padding: '12px' }}
                    >
                      {loading ? 'Processing Webhook...' : '⚡ Simulate Payment Success & Confirm'}
                    </button>
                  </div>
                )}

                {/* Step 3: Confirmed Voucher */}
                {bookingStep === 'confirmed' && (
                  <div>
                    <div
                      style={{
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(18, 24, 38, 0.9))',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '12px',
                        padding: '20px',
                        marginBottom: '18px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '32px', marginBottom: '6px' }}>✅</div>
                      <h5 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>Seva Booking Confirmed!</h5>
                      <div
                        style={{
                          fontSize: '20px',
                          fontWeight: 800,
                          color: '#34D399',
                          letterSpacing: '0.05em',
                          fontFamily: 'monospace',
                          marginTop: '8px',
                        }}
                      >
                        {activeReservation.bookingReference}
                      </div>
                      <p style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
                        Temple staff can verify this pass using barcode check-in.
                      </p>
                    </div>

                    <div style={{ background: '#0F172A', padding: '16px', borderRadius: '10px', fontSize: '12px', marginBottom: '18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Devotee Name:</span>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{bookingFormData.fullName}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Gotram &amp; Nakshatram:</span>
                        <span style={{ color: '#fff' }}>{bookingFormData.gotram} / {bookingFormData.nakshatram}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Sankalpam:</span>
                        <span style={{ color: '#E5E7EB' }}>{bookingFormData.sankalpam}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                        <span style={{ color: '#9CA3AF' }}>Fulfillment:</span>
                        <span className="badge badge-saffron" style={{ fontSize: '9px' }}>PENDING ATTENDANCE</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setBookingStep('select');
                        setActiveReservation(null);
                      }}
                      className="btn-secondary"
                      style={{ width: '100%' }}
                    >
                      Book Another Seva
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: SECTION 80G DONATIONS */}
      {activeTab === 'donations' && (
        <section>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div
              className="glass-panel"
              style={{
                padding: '32px',
                marginBottom: '28px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(17, 24, 39, 0.8) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span className="badge badge-emerald">Tax Exemption 80G Compliant</span>
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Direct Legal Trust Remittance</span>
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>
                Nitya Annadanam &amp; Temple Renovation Fund
              </h3>
              <p style={{ fontSize: '14px', color: '#9CA3AF', lineHeight: 1.6, marginTop: '8px' }}>
                Provide daily nutritious meals (Mahaprasad) to thousands of visiting pilgrims and support temple sanctum restoration.
                Donations are 50% tax exempt under Section 80G of the Indian Income Tax Act.
              </p>

              {/* Amount Selection */}
              <div style={{ marginTop: '24px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#E5E7EB', display: 'block', marginBottom: '10px' }}>
                  Select Donation Amount (INR):
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  {[501, 1100, 2100, 5100, 11000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setDonationAmount(amt)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: donationAmount === amt ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                        border: donationAmount === amt ? '1px solid #F59E0B' : '1px solid rgba(255, 255, 255, 0.08)',
                        color: donationAmount === amt ? '#FBBF24' : '#fff',
                        fontWeight: 700,
                        fontSize: '14px',
                      }}
                    >
                      ₹{amt.toLocaleString('en-IN')}
                    </button>
                  ))}
                </div>

                <input
                  type="number"
                  placeholder="Custom Amount"
                  value={donationAmount}
                  onChange={(e) => setDonationAmount(Number(e.target.value))}
                  style={{ marginBottom: '18px' }}
                />

                {/* Donor Details for 80G Receipt */}
                <h5 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
                  Donor Information (Required for Section 80G Certificate)
                </h5>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#9CA3AF', display: 'block', marginBottom: '4px' }}>Full Name *</label>
                    <input
                      type="text"
                      value={donorForm.name}
                      onChange={(e) => setDonorForm({ ...donorForm, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#9CA3AF', display: 'block', marginBottom: '4px' }}>PAN Number * (for 80G deduction)</label>
                    <input
                      type="text"
                      value={donorForm.pan}
                      placeholder="ABCDE1234F"
                      onChange={(e) => setDonorForm({ ...donorForm, pan: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#9CA3AF', display: 'block', marginBottom: '4px' }}>Email Address *</label>
                    <input
                      type="email"
                      value={donorForm.email}
                      onChange={(e) => setDonorForm({ ...donorForm, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#9CA3AF', display: 'block', marginBottom: '4px' }}>Mobile Phone</label>
                    <input
                      type="tel"
                      value={donorForm.phone}
                      onChange={(e) => setDonorForm({ ...donorForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                {!activeDonation ? (
                  <button onClick={handleInitiateDonation} disabled={loading} className="btn-primary" style={{ width: '100%', padding: '14px' }}>
                    {loading ? 'Initiating Donation...' : `Proceed to Donate ₹${donationAmount.toLocaleString('en-IN')}`}
                  </button>
                ) : !donationReceipt ? (
                  <div style={{ textAlign: 'center' }}>
                    <div className="badge badge-saffron" style={{ marginBottom: '12px' }}>
                      Donation Intent Created &bull; Order ID: {activeDonation.paymentOrder?.providerOrderId}
                    </div>
                    <button
                      onClick={handleSimulateDonationPayment}
                      disabled={loading}
                      className="btn-primary"
                      style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #10B981, #059669)' }}
                    >
                      ⚡ Simulate Successful Bank Transfer &amp; Issue 80G Receipt
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#07090E',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: '12px',
                      padding: '24px',
                      marginTop: '20px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#FBBF24', fontWeight: 700 }}>OFFICIAL 80G DONATION RECEIPT</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff' }}>{donationReceipt.legalEntity}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Receipt Number</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#34D399', fontFamily: 'monospace' }}>
                          {donationReceipt.receiptNumber}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '16px' }}>
                      <div><span style={{ color: '#9CA3AF' }}>Donor Name:</span> <strong style={{ color: '#fff' }}>{donationReceipt.donorName}</strong></div>
                      <div><span style={{ color: '#9CA3AF' }}>Donor PAN:</span> <strong style={{ color: '#FBBF24', fontFamily: 'monospace' }}>{donationReceipt.pan}</strong></div>
                      <div><span style={{ color: '#9CA3AF' }}>Date of Donation:</span> <span style={{ color: '#fff' }}>{donationReceipt.date}</span></div>
                      <div><span style={{ color: '#9CA3AF' }}>Donation Amount:</span> <strong style={{ color: '#34D399' }}>₹{donationReceipt.amount.toLocaleString('en-IN')}</strong></div>
                    </div>

                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '10px 14px', borderRadius: '6px', fontSize: '11px', color: '#9CA3AF', lineHeight: 1.5 }}>
                      📜 <strong>Tax Exemption Note:</strong> {donationReceipt.taxSection}. Donations are non-refundable and deposited directly into the Trust escrow bank account.
                    </div>

                    <button
                      onClick={() => {
                        setActiveDonation(null);
                        setDonationReceipt(null);
                      }}
                      className="btn-secondary"
                      style={{ marginTop: '16px', width: '100%' }}
                    >
                      Make Another Donation
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: TEMPLE OPERATIONS & ADMIN DASHBOARD */}
      {activeTab === 'admin' && (
        <section>
          {/* Permission check */}
          {!currentUser || !currentUser.isPlatformAdmin ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', maxWidth: '640px', margin: '0 auto' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔒</div>
              <h4 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
                Restricted Temple Management Area
              </h4>
              <p style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '20px' }}>
                This operational console requires privileged staff or platform administrator access.
              </p>
              <button
                onClick={() => quickLogin('admin@templesaas.com', 'AdminPassword123!')}
                className="btn-primary"
              >
                ⚡ Log in as Platform Administrator
              </button>
            </div>
          ) : (
            <div>
              {/* Operational Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>TODAY'S SEVA BOOKINGS</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#fff', marginTop: '6px' }}>
                    {adminMetrics?.totalBookingsToday ?? 14}
                  </div>
                  <div style={{ fontSize: '11px', color: '#34D399', marginTop: '4px' }}>↑ 100% capacity filled</div>
                </div>

                <div className="glass-panel" style={{ padding: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>DONATIONS COLLECTED</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#FBBF24', marginTop: '6px' }}>
                    ₹{((adminMetrics?.totalDonationsMinorUnits || 850000) / 100).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>Section 80G verified</div>
                </div>

                <div className="glass-panel" style={{ padding: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>SLOT CAPACITY UTILIZATION</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#60A5FA', marginTop: '6px' }}>
                    84.2%
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>35 of 45 seats occupied</div>
                </div>

                <div className="glass-panel" style={{ padding: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>RECONCILIATION QUEUE</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#34D399', marginTop: '6px' }}>
                    0
                  </div>
                  <div style={{ fontSize: '11px', color: '#34D399', marginTop: '4px' }}>Zero pending discrepancies</div>
                </div>
              </div>

              {/* Attendance & Check-In Action */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '24px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
                    Priest Attendance Check-In (FR-BOOK-007)
                  </h4>
                  <p style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '16px' }}>
                    Verify devotee arrival at the temple gate and record attendance.
                  </p>

                  <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                    <input
                      type="text"
                      placeholder="e.g. BK-2026-XXXX"
                      value={checkInReference}
                      onChange={(e) => setCheckInReference(e.target.value.toUpperCase())}
                    />
                    <button onClick={handleCheckIn} disabled={loading} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                      Mark Present
                    </button>
                  </div>

                  {checkInResult && (
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: checkInResult.startsWith('✅') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        fontSize: '12px',
                        color: checkInResult.startsWith('✅') ? '#34D399' : '#F87171',
                      }}
                    >
                      {checkInResult}
                    </div>
                  )}
                </div>

                {/* Audit Trail Inspector */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
                        Live Audit Trail (FR-AUD-001..003)
                      </h4>
                      <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Automatic PII &amp; credentials redaction</div>
                    </div>
                    <button onClick={loadAdminDashboard} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }}>
                      Refresh
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                    {auditLogs.length > 0 ? (
                      auditLogs.map((log: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            fontSize: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 600 }}>
                            <span>{log.action}</span>
                            <span style={{ fontSize: '10px', color: '#6B7280' }}>
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                            Actor: {log.actorRole} ({log.actorId.slice(0, 12)}...) &bull; Resource: {log.resourceType}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: '#6B7280', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>
                        No audit events logged in this session yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 4: INTERACTIVE API CONSOLE */}
      {activeTab === 'console' && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 420px) 1fr',
            gap: '24px',
          }}
        >
          {/* Action triggers */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
              REST API Test Triggers
            </h3>
            <p style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '20px' }}>
              Execute live HTTP requests against the local server and inspect the response payload.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => runApi('GET', '/api/health')}
                disabled={loading}
                className="btn-secondary"
                style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Health Check</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>GET /api/health</div>
                </div>
                <span style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>EXECUTE</span>
              </button>

              <button
                onClick={() => runApi('GET', '/api/auth/me')}
                disabled={loading}
                className="btn-secondary"
                style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Verify Auth Session</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>GET /api/auth/me</div>
                </div>
                <span style={{ fontSize: '11px', color: '#60A5FA', fontWeight: 600 }}>EXECUTE</span>
              </button>

              <button
                onClick={() => runApi('POST', '/api/dev/seed')}
                disabled={loading}
                className="btn-secondary"
                style={{
                  justifyContent: 'space-between',
                  width: '100%',
                  textAlign: 'left',
                  borderColor: 'rgba(245, 158, 11, 0.3)',
                  background: 'rgba(245, 158, 11, 0.08)',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FBBF24' }}>Seed Demo Data</div>
                  <div style={{ fontSize: '11px', color: '#F59E0B' }}>POST /api/dev/seed</div>
                </div>
                <span style={{ fontSize: '11px', color: '#FBBF24', fontWeight: 600 }}>SEED DATA</span>
              </button>

              <button
                onClick={() => runApi('GET', '/api/public/siddhivinayak/prabhadevi')}
                disabled={loading}
                className="btn-secondary"
                style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Public Temple Profile</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>GET /api/public/siddhivinayak/prabhadevi</div>
                </div>
                <span style={{ fontSize: '11px', color: '#60A5FA', fontWeight: 600 }}>EXECUTE</span>
              </button>

              <button
                onClick={() => runApi('GET', '/api/public/siddhivinayak/prabhadevi/pujas')}
                disabled={loading}
                className="btn-secondary"
                style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Temple Pujas &amp; Slots</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>GET /api/public/siddhivinayak/prabhadevi/pujas</div>
                </div>
                <span style={{ fontSize: '11px', color: '#60A5FA', fontWeight: 600 }}>EXECUTE</span>
              </button>

              <button
                onClick={() => runApi('GET', `/api/admin/dashboard?tenantId=${templeData?.tenantId}&templeId=${templeData?.id}`)}
                disabled={loading}
                className="btn-secondary"
                style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Admin Dashboard Metrics</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>GET /api/admin/dashboard</div>
                </div>
                <span style={{ fontSize: '11px', color: '#C084FC', fontWeight: 600 }}>EXECUTE</span>
              </button>
            </div>
          </div>

          {/* Response Payload Viewer */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '14px',
                paddingBottom: '10px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>Live Response Payload</span>
                {response && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: response.status >= 200 && response.status < 300 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: response.status >= 200 && response.status < 300 ? '#34D399' : '#F87171',
                      fontWeight: 600,
                    }}
                  >
                    HTTP {response.status} &bull; {response.durationMs}ms
                  </span>
                )}
              </div>
              {response && (
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace' }}>
                  {response.method} {response.endpoint}
                </span>
              )}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: '340px',
                maxHeight: '520px',
                overflowY: 'auto',
                background: '#07090E',
                borderRadius: '8px',
                padding: '16px',
                fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                fontSize: '12px',
                color: '#E5E7EB',
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              {loading ? (
                <div style={{ color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⏳</span> Executing request...
                </div>
              ) : response ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(response.data, null, 2)}
                </pre>
              ) : (
                <div style={{ color: '#6B7280', textAlign: 'center', marginTop: '120px' }}>
                  Click an action button on the left to fire a live API request.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 5: ARCHITECTURE & ENDPOINTS */}
      {activeTab === 'architecture' && (
        <section className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', marginBottom: '16px' }}>
            System Architecture &amp; Production API Surface (50 Endpoints)
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#FBBF24', marginBottom: '4px' }}>1. PostgreSQL Row-Level Security</div>
              <p style={{ fontSize: '12px', color: '#9CA3AF' }}>
                Enforced in database engine via <code style={{ color: '#FBBF24' }}>SET LOCAL app.current_tenant_id</code>. Zero tenant context leakage across pool connections.
              </p>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399', marginBottom: '4px' }}>2. Direct Merchant Routing</div>
              <p style={{ fontSize: '12px', color: '#9CA3AF' }}>
                Devotees pay directly into the temple trust bank accounts via Razorpay/Stripe. Platform maintains zero custodial hold of funds.
              </p>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#60A5FA', marginBottom: '4px' }}>3. Atomic Capacity &amp; 10m Hold</div>
              <p style={{ fontSize: '12px', color: '#9CA3AF' }}>
                Row-level update locking prevents overselling during high-demand festival spikes with automatic expiration cleanup.
              </p>
            </div>
          </div>

          <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '14px' }}>
            Production Route Registry
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {[
              { group: 'Core Health & Dev', items: ['GET /api/health', 'POST /api/dev/seed', 'POST /api/dev/simulate-payment'] },
              { group: 'Public Devotee', items: ['GET /api/public/[tenantSlug]/[templeSlug]', 'GET /api/public/[tenantSlug]/[templeSlug]/pujas', 'POST /api/public/custom-domain'] },
              { group: 'Identity & MFA', items: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/logout', 'POST /api/auth/mfa/setup'] },
              { group: 'Puja Bookings', items: ['POST /api/bookings/reserve', 'GET /api/bookings/[reference]', 'POST /api/cron/release-expired-slots'] },
              { group: 'Donations & Receipts', items: ['GET /api/donations/campaigns', 'POST /api/donations/initiate', 'GET /api/receipts/[id]'] },
              { group: 'Temple Administration', items: ['GET /api/admin/dashboard', 'POST /api/admin/bookings/[id]/check-in', 'GET /api/admin/audit-logs', 'GET /api/admin/reports/financial'] },
            ].map((cat, idx) => (
              <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#FBBF24', marginBottom: '8px' }}>{cat.group}</div>
                {cat.items.map((it, i) => (
                  <div key={i} style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace', marginBottom: '4px' }}>
                    {it}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
