import React, { useMemo, useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line, ContactShadows } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 8
  return t
}
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }

function woodBoards(vertical, base, seed) {
  return (g, w, h) => {
    const r = rnd(seed)
    const n = 8, size = (vertical ? w : h) / n
    for (let i = 0; i < n; i++) {
      const l = 0.85 + r() * 0.3
      const c = new THREE.Color(base).multiplyScalar(l)
      g.fillStyle = '#' + c.getHexString()
      if (vertical) g.fillRect(i * size, 0, size, h); else g.fillRect(0, i * size, w, size)
      g.strokeStyle = 'rgba(0,0,0,0.12)'
      for (let k = 0; k < 14; k++) {
        g.lineWidth = 0.6 + r() * 1.2
        g.beginPath()
        const off = i * size + r() * size
        if (vertical) { g.moveTo(off, 0); g.bezierCurveTo(off + 6, h * 0.3, off - 6, h * 0.7, off + 2, h) }
        else { g.moveTo(0, off); g.bezierCurveTo(w * 0.3, off + 4, w * 0.7, off - 4, w, off + 1) }
        g.stroke()
      }
      g.fillStyle = 'rgba(0,0,0,0.55)'
      if (vertical) g.fillRect(i * size, 0, 3, h); else g.fillRect(0, i * size, w, 3)
    }
  }
}

function carpetPattern(g, w, h) {
  g.fillStyle = '#7d2418'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#e8d3b0'; g.fillRect(0, 0, w, 26); g.fillRect(0, h - 26, w, 26)
  g.fillStyle = '#3b1410'; g.fillRect(0, 26, w, 14); g.fillRect(0, h - 40, w, 14)
  g.strokeStyle = '#d9a35b'; g.lineWidth = 3
  for (let x = 0; x < w; x += 64) {
    for (let y = 70; y < h - 70; y += 64) {
      g.beginPath(); g.moveTo(x + 32, y); g.lineTo(x + 56, y + 32); g.lineTo(x + 32, y + 64); g.lineTo(x + 8, y + 32); g.closePath(); g.stroke()
      g.fillStyle = '#b5532f'; g.beginPath(); g.arc(x + 32, y + 32, 6, 0, Math.PI * 2); g.fill()
    }
  }
}

function skirtPattern(g, w, h) {
  g.fillStyle = '#5a1714'; g.fillRect(0, 0, w, h)
  for (let y = 0; y < h; y += 48) {
    g.fillStyle = '#b8873a'; g.fillRect(0, y, w, 6)
    g.fillStyle = '#8a2a1f'; g.fillRect(0, y + 10, w, 4)
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = '#c99a4b'
      g.beginPath(); g.moveTo(x + 16, y + 18); g.lineTo(x + 26, y + 32); g.lineTo(x + 16, y + 44); g.lineTo(x + 6, y + 32); g.closePath(); g.fill()
    }
  }
}

function cushionPattern(g, w, h) {
  g.fillStyle = '#5e1a1a'; g.fillRect(0, 0, w, h)
  const s = w / 4
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = (i + j) % 2 ? '#e9dcc6' : '#2b1010'
    g.beginPath(); g.moveTo(i * s + s / 2, j * s + 6); g.lineTo(i * s + s - 6, j * s + s - 6); g.lineTo(i * s + 6, j * s + s - 6); g.closePath(); g.fill()
  }
}

/* ---------- geometry helpers ---------- */
function taperTube(points, r0, r1, seg = 48, rad = 14) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  const fr = curve.computeFrenetFrames(seg, false)
  const pos = [], idx = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const P = curve.getPointAt(t)
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 1.4))
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2
      const v = P.clone().addScaledVector(fr.normals[i], Math.cos(a) * r).addScaledVector(fr.binormals[i], Math.sin(a) * r)
      pos.push(v.x, v.y, v.z)
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function sag(a, b, depth, n = 18) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([
      THREE.MathUtils.lerp(a[0], b[0], t),
      THREE.MathUtils.lerp(a[1], b[1], t) - Math.sin(Math.PI * t) * depth,
      THREE.MathUtils.lerp(a[2], b[2], t),
    ])
  }
  return pts
}

const UP = new THREE.Vector3(0, 1, 0)
function Limb({ a, b, r, color, map, rough = 0.75 }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
    const d = B.clone().sub(A)
    const len = d.length()
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())
    return { pos: A.clone().add(B).multiplyScalar(0.5).toArray(), quat, len }
  }, [a.join(), b.join()])
  return (
    <mesh position={pos} quaternion={quat} castShadow receiveShadow>
      <capsuleGeometry args={[r, Math.max(0.001, len), 6, 14]} />
      <meshStandardMaterial color={map ? '#ffffff' : color} map={map || null} roughness={rough} />
    </mesh>
  )
}

/* ---------- palette ---------- */
const SKIN = '#d9ab8c'
const HAIR = '#140d0a'
const LACQUER = '#5c1a14'
const GOLD = '#c79a45'
const IVORY = '#efe3c8'

/* ---------- room ---------- */
function Room() {
  const floor = useMemo(() => canvasTex(512, 512, woodBoards(false, '#5a321b', 7), [2, 2]), [])
  const wall = useMemo(() => canvasTex(512, 512, woodBoards(true, '#3d2416', 11), [2, 1.4]), [])
  const carpet = useMemo(() => canvasTex(512, 256, carpetPattern), [])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[10, 7.4]} />
        <meshStandardMaterial map={floor} roughness={0.55} />
      </mesh>
      {/* base plinth of the diorama */}
      <mesh position={[0, -0.262, 0]} receiveShadow>
        <boxGeometry args={[10.4, 0.5, 7.8]} />
        <meshStandardMaterial color="#1b130e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.75, -3.7]} receiveShadow>
        <boxGeometry args={[10, 5.5, 0.12]} />
        <meshStandardMaterial map={wall} roughness={0.8} />
      </mesh>
      <mesh position={[-5, 2.75, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <boxGeometry args={[7.4, 5.5, 0.12]} />
        <meshStandardMaterial map={wall} roughness={0.8} />
      </mesh>
      <mesh position={[0.3, 0.012, 1.55]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[6.6, 3.1]} />
        <meshStandardMaterial map={carpet} roughness={0.95} />
      </mesh>
    </group>
  )
}

/* ---------- platform & altar ---------- */
function Platform() {
  return (
    <group>
      <mesh position={[0, 0.58, -1.4]} castShadow receiveShadow>
        <boxGeometry args={[8.2, 0.24, 2.7]} />
        <meshStandardMaterial color="#4a2614" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.25, -1.4]} castShadow receiveShadow>
        <boxGeometry args={[7.6, 0.5, 2.3]} />
        <meshStandardMaterial color="#2e180d" roughness={0.6} />
      </mesh>
      {[-3.7, 3.7].map(x => [-0.25, -2.55].map(z => (
        <mesh key={x + '' + z} position={[x, 0.22, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.22, 0.44, 12]} />
          <meshStandardMaterial color="#2a150b" roughness={0.5} />
        </mesh>
      )))}
    </group>
  )
}

function Tier({ y, w, d, z }) {
  return (
    <group>
      <mesh position={[0, y - 0.3, z]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.6, d]} />
        <meshStandardMaterial color={LACQUER} roughness={0.35} />
      </mesh>
      <mesh position={[0, y - 0.03, z + d / 2 + 0.01]}>
        <boxGeometry args={[w, 0.06, 0.03]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Statue({ position, s = 1, tone = 'gold' }) {
  const geo = useMemo(() => {
    const p = [
      [0, 0], [0.2, 0], [0.2, 0.08], [0.14, 0.1], [0.16, 0.3], [0.18, 0.45], [0.12, 0.6],
      [0.07, 0.65], [0.1, 0.72], [0.1, 0.82], [0.07, 0.88], [0.05, 0.98], [0.02, 1.12], [0, 1.18],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    return new THREE.LatheGeometry(p, 20)
  }, [])
  const mat = tone === 'gold'
    ? <meshStandardMaterial color={GOLD} metalness={0.75} roughness={0.32} />
    : <meshStandardMaterial color="#7b7364" roughness={0.85} />
  return <mesh geometry={geo} position={position} scale={s} castShadow>{mat}</mesh>
}

function phorKaeFace(g, w, h) {
  const cx = 256
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, '#e2a636'); grd.addColorStop(0.5, '#d4922a'); grd.addColorStop(1, '#a8661a')
  g.fillStyle = grd; g.fillRect(0, 0, w, h)
  const glow = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
  ;[-1, 1].forEach(s => glow(cx + s * 70, 300, 50, 'rgba(255,215,120,0.35)'))
  g.strokeStyle = 'rgba(90,40,5,0.75)'; g.lineCap = 'round'
  // forehead wrinkles
  g.lineWidth = 3
  ;[176, 192, 206].forEach((y, i) => { g.beginPath(); g.moveTo(cx - 70 + i * 6, y + 6); g.quadraticCurveTo(cx, y - 8, cx + 70 - i * 6, y + 6); g.stroke() })
  g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 8, 212); g.lineTo(cx - 4, 238); g.moveTo(cx + 8, 212); g.lineTo(cx + 4, 238); g.stroke()
  ;[-1, 1].forEach(s => {
    const ex = cx + s * 62, ey = 252
    glow(ex, ey, 34, 'rgba(70,25,0,0.55)')
    g.fillStyle = '#efe6cf'
    g.beginPath(); g.moveTo(ex - s * 26, ey + 2); g.quadraticCurveTo(ex, ey - 14, ex + s * 26, ey + 2); g.quadraticCurveTo(ex, ey + 12, ex - s * 26, ey + 2); g.fill()
    g.fillStyle = '#1d0f05'; g.beginPath(); g.arc(ex - s * 2, ey, 9, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(60,25,0,0.9)'; g.lineWidth = 3.5
    g.beginPath(); g.moveTo(ex - s * 28, ey + 1); g.quadraticCurveTo(ex, ey - 17, ex + s * 28, ey + 1); g.stroke()
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(90,40,5,0.7)'
    ;[0, 1, 2].forEach(k => { g.beginPath(); g.moveTo(ex + s * 30, ey - 6 + k * 8); g.lineTo(ex + s * 48, ey - 12 + k * 10); g.stroke() })
    g.beginPath(); g.moveTo(ex - s * 18, ey + 16); g.quadraticCurveTo(ex, ey + 26, ex + s * 22, ey + 16); g.stroke()
    // nasolabial folds
    g.lineWidth = 4; g.strokeStyle = 'rgba(85,35,0,0.7)'
    g.beginPath(); g.moveTo(cx + s * 30, 285); g.quadraticCurveTo(cx + s * 52, 320, cx + s * 44, 352); g.stroke()
  })
}

function TeacherHead() {
  const face = useMemo(() => canvasTex(1024, 512, phorKaeFace), [])
  const gold = <meshStandardMaterial color="#dca43a" metalness={0.85} roughness={0.28} />
  const deepGold = <meshStandardMaterial color="#b9802a" metalness={0.85} roughness={0.32} />
  const white = <meshStandardMaterial color="#ede8dc" roughness={1} />
  const tier1 = useMemo(() => new THREE.LatheGeometry([[0.4, 0], [0.43, 0.05], [0.41, 0.16], [0.37, 0.2], [0.4, 0.34], [0.45, 0.46], [0.47, 0.5], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 40), [])
  const tier2 = useMemo(() => new THREE.LatheGeometry([[0.34, 0], [0.3, 0.12], [0.32, 0.18], [0.42, 0.3], [0.5, 0.36], [0.52, 0.4], [0, 0.4]].map(([x, y]) => new THREE.Vector2(x, y)), 40), [])
  const jewels = useMemo(() => {
    const out = [], cols = ['#d1203a', '#1f9a5a', '#2a6fd6', '#f2e2a0']
    ;[[0.42, 0.97, 22], [0.475, 1.53, 26], [0.535, 1.93, 28]].forEach(([r, y, n], ri) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        if (Math.cos(a) < -0.2) continue
        out.push({ p: [Math.sin(a) * r, y, Math.cos(a) * r * 0.9], c: cols[(i + ri) % cols.length] })
      }
    })
    return out
  }, [])
  return (
    <group position={[0, 2.5, -3.05]} scale={0.9}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.62, 0.24, 32]} />
        <meshStandardMaterial color={LACQUER} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.25, 0]}><torusGeometry args={[0.5, 0.03, 8, 40]} />{gold}</mesh>
      {/* face */}
      <mesh position={[0, 0.66, 0]} scale={[0.95, 1.08, 0.9]} castShadow>
        <sphereGeometry args={[0.42, 48, 36]} />
        <meshStandardMaterial map={face} metalness={0.55} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.45, 0.06]} scale={[1, 0.8, 1]} castShadow><sphereGeometry args={[0.3, 28, 18]} /><meshStandardMaterial color="#c88a28" metalness={0.6} roughness={0.38} /></mesh>
      {/* nose */}
      <Limb a={[0, 0.84, 0.36]} b={[0, 0.7, 0.4]} r={0.045} color="#d89a2e" rough={0.35} />
      <mesh position={[0, 0.66, 0.405]} scale={[1.15, 0.9, 0.9]} castShadow><sphereGeometry args={[0.065, 18, 14]} /><meshStandardMaterial color="#d89a2e" metalness={0.55} roughness={0.35} /></mesh>
      {[-1, 1].map(s => <mesh key={s} position={[s * 0.06, 0.645, 0.37]} scale={[1, 0.8, 1]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial color="#d89a2e" metalness={0.55} roughness={0.35} /></mesh>)}
      {/* bushy white brows */}
      {[-1, 1].map(s => (
        <group key={s}>
          <Limb a={[s * 0.06, 0.86, 0.36]} b={[s * 0.24, 0.9, 0.29]} r={0.034} color="#ede8dc" rough={1} />
          <Limb a={[s * 0.1, 0.88, 0.35]} b={[s * 0.27, 0.86, 0.26]} r={0.026} color="#f6f2ea" rough={1} />
        </group>
      ))}
      {/* moustache and open mouth */}
      {[-1, 1].map(s => (
        <group key={s}>
          <Limb a={[0, 0.575, 0.39]} b={[s * 0.15, 0.55, 0.35]} r={0.032} color="#ede8dc" rough={1} />
          <Limb a={[s * 0.15, 0.55, 0.35]} b={[s * 0.21, 0.47, 0.29]} r={0.024} color="#ede8dc" rough={1} />
        </group>
      ))}
      <mesh position={[0, 0.47, 0.35]} scale={[1.25, 0.5, 0.45]}><sphereGeometry args={[0.1, 20, 14]} /><meshStandardMaterial color="#2a0306" roughness={0.6} /></mesh>
      <mesh position={[0, 0.47, 0.37]} scale={[1.25, 0.55, 1]}><torusGeometry args={[0.095, 0.022, 10, 32]} /><meshStandardMaterial color="#b3202a" roughness={0.35} /></mesh>
      {[-1, 1].map(s => <mesh key={s} position={[s * 0.035, 0.49, 0.39]}><boxGeometry args={[0.032, 0.035, 0.012]} />{white}</mesh>)}
      <Limb a={[-0.05, 0.36, 0.33]} b={[0.05, 0.36, 0.33]} r={0.03} color="#ede8dc" rough={1} />
      {/* ears */}
      {[-1, 1].map(s => <mesh key={s} position={[s * 0.4, 0.66, 0.02]} scale={[0.35, 1, 0.7]} castShadow><sphereGeometry args={[0.12, 16, 12]} />{gold}</mesh>)}
      {/* chada crown: jewelled band, two flaring tiers, petal crest */}
      <mesh position={[0, 0.97, 0]} scale={[1, 1, 0.9]} castShadow><cylinderGeometry args={[0.43, 0.42, 0.1, 40]} />{deepGold}</mesh>
      <mesh geometry={tier1} position={[0, 1.02, 0]} scale={[1, 1, 0.9]} castShadow>{gold}</mesh>
      <mesh geometry={tier2} position={[0, 1.52, 0]} scale={[1, 1, 0.9]} castShadow>{gold}</mesh>
      <group position={[0, 1.3, 0.37]}>
        <mesh rotation-z={Math.PI / 4}><boxGeometry args={[0.15, 0.15, 0.03]} />{deepGold}</mesh>
        <mesh rotation-z={Math.PI / 4} position={[0, 0, 0.012]}><boxGeometry args={[0.1, 0.1, 0.02]} /><meshStandardMaterial color="#1c0b06" roughness={0.5} /></mesh>
        <mesh position={[0, 0, 0.025]}><sphereGeometry args={[0.022, 12, 10]} /><meshStandardMaterial color="#d1203a" emissive="#d1203a" emissiveIntensity={0.4} metalness={0.3} roughness={0.2} /></mesh>
      </group>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.sin(a) * 0.46, 2.04, Math.cos(a) * 0.42]} rotation={[Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]} castShadow>
            <coneGeometry args={[0.08, 0.26, 4]} />{gold}
          </mesh>
        )
      })}
      <mesh position={[0, 2.18, 0.18]} rotation-x={0.25} scale={[1, 1, 0.35]} castShadow><coneGeometry args={[0.17, 0.42, 6]} /><meshStandardMaterial color="#e48a2a" metalness={0.7} roughness={0.3} /></mesh>
      {jewels.map((j, i) => (
        <mesh key={i} position={j.p}><sphereGeometry args={[0.018, 8, 6]} /><meshStandardMaterial color={j.c} emissive={j.c} emissiveIntensity={0.35} metalness={0.3} roughness={0.15} /></mesh>
      ))}
      {/* flame spikes at the temples */}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[s * 0.5, 1.02, 0.02]} rotation-z={-s * 0.45} castShadow><coneGeometry args={[0.035, 0.6, 6]} />{gold}</mesh>
          <mesh position={[s * 0.44, 1.3, 0.05]} rotation-z={-s * 0.3} castShadow><coneGeometry args={[0.025, 0.42, 6]} />{gold}</mesh>
        </group>
      ))}
    </group>
  )
}

function Tusk({ side }) {
  const geo = useMemo(() => taperTube([
    [side * 4.35, 0.0, -2.75], [side * 4.55, 1.6, -2.75], [side * 4.4, 3.2, -2.85], [side * 3.8, 4.3, -2.95], [side * 3.0, 4.75, -3.05],
  ], 0.24, 0.025), [side])
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={IVORY} roughness={0.38} side={THREE.DoubleSide} />
    </mesh>
  )
}

/* ---------- candles ---------- */
const CANDLES = [
  [-2.6, 1.3, -2.55, 0.32], [-1.9, 1.3, -2.55, 0.26], [2.0, 1.3, -2.55, 0.3], [2.7, 1.3, -2.55, 0.24],
  [-1.5, 1.9, -2.85, 0.28], [1.45, 1.9, -2.85, 0.32], [-0.75, 2.5, -3.0, 0.22], [0.8, 2.5, -3.0, 0.24],
  [-3.5, 0.7, -2.2, 0.36], [-3.1, 0.7, -2.3, 0.26], [3.4, 0.7, -0.5, 0.38], [3.65, 0.7, -0.75, 0.28],
  [3.1, 0.7, -0.35, 0.22], [-2.2, 0.7, -0.5, 0.2],
]
function Candle({ p, night }) {
  const flame = useRef()
  const seed = useMemo(() => Math.random() * 10, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed
    if (flame.current) {
      const f = 1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05
      flame.current.scale.set(1, f, 1)
    }
  })
  const [x, y, z, h] = p
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.055, h, 12]} />
        <meshStandardMaterial color="#f4ecdc" roughness={0.6} emissive="#ffb35a" emissiveIntensity={night ? 0.15 : 0} />
      </mesh>
      <mesh ref={flame} position={[0, h + 0.07, 0]}>
        <coneGeometry args={[0.028, 0.12, 10]} />
        <meshBasicMaterial color={[4.5, 2.2, 0.7]} toneMapped={false} />
      </mesh>
    </group>
  )
}

function CandleLights({ night }) {
  const refs = useRef([])
  const spots = [[-2.3, 1.9, -2.2], [1.8, 2.2, -2.3], [3.4, 1.3, -0.3], [-3.2, 1.3, -1.9]]
  useFrame(({ clock }) => {
    refs.current.forEach((l, i) => {
      if (!l) return
      const t = clock.elapsedTime * 7 + i * 3
      l.intensity = night ? 5.5 + Math.sin(t) * 0.6 + Math.sin(t * 2.7) * 0.4 : 0
    })
  })
  return spots.map((p, i) => (
    <pointLight key={i} ref={el => (refs.current[i] = el)} position={p} color="#ffa04a" distance={7} decay={1.6} />
  ))
}

/* ---------- marigolds ---------- */
function Marigolds() {
  const ref = useRef()
  const items = useMemo(() => {
    const r = rnd(42), out = []
    const clusters = [
      [-2.25, 1.32, -2.45, 10], [2.35, 1.32, -2.45, 10], [-1.0, 1.92, -2.8, 7], [1.0, 1.92, -2.8, 7],
      [-3.75, 0.72, -1.6, 14], [-3.3, 0.72, -1.0, 9], [3.2, 0.72, -1.2, 10], [-2.7, 0.72, -0.4, 8],
    ]
    clusters.forEach(([x, y, z, n]) => {
      for (let i = 0; i < n; i++) out.push([x + (r() - 0.5) * 0.45, y + r() * 0.12, z + (r() - 0.5) * 0.35, r()])
    })
    // hanging garlands under the altar edge
    ;[[-3.0, 1.25, -2.05, -0.4, 1.25, -2.05], [0.4, 1.25, -2.05, 3.0, 1.25, -2.05]].forEach(([ax, ay, az, bx, by, bz]) => {
      sag([ax, ay, az], [bx, by, bz], 0.35, 30).forEach(p => out.push([...p, r()]))
    })
    // standing garland pillars on the wall
    ;[-4.6, 4.6].forEach(x => { for (let i = 0; i < 26; i++) out.push([x * 0.93, 1.2 + i * 0.09, -3.55, r()]) })
    return out
  }, [])
  useEffect(() => {
    const m = new THREE.Matrix4(), c = new THREE.Color()
    items.forEach(([x, y, z, k], i) => {
      m.makeTranslation(x, y, z)
      ref.current.setMatrixAt(i, m)
      ref.current.setColorAt(i, c.set(k > 0.55 ? '#f29a1d' : k > 0.2 ? '#e8b021' : '#d4621a'))
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.instanceColor.needsUpdate = true
  }, [items])
  return (
    <instancedMesh ref={ref} args={[null, null, items.length]} castShadow>
      <icosahedronGeometry args={[0.065, 1]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  )
}

/* ---------- sacred threads ---------- */
function Threads() {
  const top = [0, 4.35, -3.0]
  const anchors = [
    [-3.4, 4.55, -3.0], [3.4, 4.55, -3.0], [-4.4, 2.8, -2.85], [4.4, 2.8, -2.85],
    [-3.9, 0.75, -0.3], [3.9, 0.75, -0.3], [-2.4, 2.0, -2.6], [2.4, 2.0, -2.6],
  ]
  return (
    <group>
      {anchors.map((a, i) => (
        <Line key={i} points={sag(top, a, 0.12 + (i % 3) * 0.05)} color="#efe6d4" lineWidth={1.1} transparent opacity={0.85} />
      ))}
      <Line points={sag([-4.4, 2.8, -2.85], [4.4, 2.8, -2.85], 0.5, 40)} color="#efe6d4" lineWidth={1} transparent opacity={0.7} />
    </group>
  )
}

/* ---------- offerings & props ---------- */
function Offerings() {
  return (
    <group>
      {[[-3.2, -0.55], [-2.6, -0.75]].map(([x, z], i) => (
        <group key={i} position={[x, 0.71, z]}>
          <mesh receiveShadow castShadow><cylinderGeometry args={[0.32, 0.26, 0.06, 24]} /><meshStandardMaterial color="#b9884a" metalness={0.6} roughness={0.35} /></mesh>
          {[[0, 0.1, 0], [0.13, 0.09, 0.08], [-0.12, 0.09, -0.06], [0.05, 0.19, -0.02]].map((p, j) => (
            <mesh key={j} position={p} castShadow><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color={j % 2 ? '#e7a04a' : '#f2ead8'} roughness={0.6} /></mesh>
          ))}
        </group>
      ))}
      <Cushion />
    </group>
  )
}

function Cushion() {
  const tex = useMemo(() => canvasTex(256, 256, cushionPattern), [])
  const prism = useMemo(() => {
    const s = new THREE.Shape(); s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0, 0.95); s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 })
  }, [])
  return (
    <group position={[2.7, 0.7, -1.0]} rotation-y={-0.35}>
      <mesh geometry={prism} position={[0, 0, -0.3]} castShadow><meshStandardMaterial map={tex} roughness={0.85} /></mesh>
      <mesh position={[0, 0.17, 0.55]} castShadow><boxGeometry args={[1.2, 0.34, 0.7]} /><meshStandardMaterial map={tex} roughness={0.85} /></mesh>
    </group>
  )
}

/* ---------- figurines ---------- */
const ZAX = new THREE.Vector3(0, 0, 1)
function Slab({ a, b, w, t, color, map, rough = 0.6, metal = 0 }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
    const d = B.clone().sub(A)
    return { pos: A.clone().add(B).multiplyScalar(0.5).toArray(), quat: new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), len: d.length() }
  }, [a.join(), b.join()])
  return (
    <mesh position={pos} quaternion={quat} castShadow receiveShadow>
      <boxGeometry args={[w, len, t]} />
      <meshStandardMaterial color={map ? '#ffffff' : color} map={map || null} roughness={rough} metalness={metal} />
    </mesh>
  )
}
function Bangle({ at, dir, r = 0.055, color = GOLD }) {
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(ZAX, new THREE.Vector3(...dir).normalize()), [dir.join()])
  return (
    <mesh position={at} quaternion={quat}>
      <torusGeometry args={[r, 0.011, 8, 28]} />
      <meshStandardMaterial color={color} metalness={0.9} roughness={0.25} />
    </mesh>
  )
}
function LatheBody({ profile, position, rotation = [0, 0, 0], scale = [1, 1, 1], color, map, rough = 0.6 }) {
  const geo = useMemo(() => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 32), [])
  return (
    <mesh geometry={geo} position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
      <meshStandardMaterial color={map ? '#ffffff' : color} map={map || null} roughness={rough} side={THREE.DoubleSide} />
    </mesh>
  )
}
function Hand({ position, scale = [0.06, 0.035, 0.08], rotation = [0, 0, 0] }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow>
      <sphereGeometry args={[1, 14, 10]} />
      <meshStandardMaterial color={SKIN} roughness={0.65} />
    </mesh>
  )
}
/* painted makeup, mapped onto the head sphere (front of face = u 0.25) */
function possessedFace(g, w, h) {
  const cx = 256
  g.fillStyle = SKIN; g.fillRect(0, 0, w, h)
  const glow = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
  // chalky white powder, patchy
  ;[[cx - 70, 270, 70], [cx + 70, 270, 70], [cx, 230, 60], [cx, 300, 50], [cx - 40, 200, 45], [cx + 45, 205, 45]].forEach(([x, y, r]) => glow(x, y, r, 'rgba(245,242,236,0.85)'))
  ;[[cx - 95, 300, 12], [cx + 30, 190, 9], [cx + 100, 250, 10]].forEach(([x, y, r]) => glow(x, y, r, 'rgba(150,140,130,0.35)'))
  ;[-1, 1].forEach(s => {
    const ex = cx + s * 60, ey = 245
    glow(ex, ey + 6, 30, 'rgba(60,40,40,0.55)')
    g.fillStyle = '#ece8e2'
    g.beginPath(); g.moveTo(ex - s * 22, ey); g.quadraticCurveTo(ex, ey - 14, ex + s * 22, ey - 2); g.quadraticCurveTo(ex, ey + 9, ex - s * 22, ey); g.fill()
    g.fillStyle = '#a6a39b'; g.beginPath(); g.arc(ex, ey - 4, 7, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#4a4440'; g.beginPath(); g.arc(ex, ey - 4, 2.4, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#120a08'; g.lineWidth = 2.5; g.lineCap = 'round'
    g.beginPath(); g.moveTo(ex - s * 23, ey + 1); g.quadraticCurveTo(ex, ey - 16, ex + s * 23, ey - 3); g.stroke()
    g.strokeStyle = 'rgba(30,15,12,0.8)'; g.lineWidth = 3.5
    g.beginPath(); g.moveTo(ex - s * 22, 212); g.quadraticCurveTo(ex, 204, ex + s * 26, 214); g.stroke()
  })
  g.strokeStyle = 'rgba(120,90,80,0.35)'; g.lineWidth = 2
  g.beginPath(); g.moveTo(cx - 9, 238); g.quadraticCurveTo(cx - 12, 268, cx - 7, 283); g.stroke()
  // red smile carried up onto both cheeks
  g.strokeStyle = '#a3141c'; g.lineCap = 'round'
  ;[-1, 1].forEach(s => {
    g.lineWidth = 7; g.beginPath(); g.moveTo(cx + s * 28, 330); g.quadraticCurveTo(cx + s * 62, 330, cx + s * 84, 290); g.stroke()
    g.lineWidth = 3; g.strokeStyle = 'rgba(163,20,28,0.5)'; g.beginPath(); g.moveTo(cx + s * 70, 312); g.lineTo(cx + s * 90, 300); g.stroke()
    g.strokeStyle = '#a3141c'
  })
  g.fillStyle = '#a3141c'
  g.beginPath(); g.moveTo(cx - 34, 324); g.quadraticCurveTo(cx, 310, cx + 34, 324); g.quadraticCurveTo(cx, 352, cx - 34, 324); g.fill()
  g.fillStyle = '#2a0808'; g.beginPath(); g.ellipse(cx, 329, 24, 6, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#efe8dc'; g.fillRect(cx - 18, 323, 36, 5)
  // wet strands of hair across the face
  g.strokeStyle = 'rgba(14,9,8,0.92)'; g.lineWidth = 3
  ;[[cx - 30, 140, cx - 10, 230, cx - 2, 300], [cx + 10, 140, cx - 4, 220, cx + 6, 280], [cx + 40, 150, cx + 70, 230, cx + 62, 320], [cx - 60, 150, cx - 80, 220, cx - 70, 300]].forEach(([a, b, c, d, e, f]) => {
    g.beginPath(); g.moveTo(a, b); g.quadraticCurveTo(c, d, e, f); g.stroke()
  })
}

function makeupFace(look) {
  if (look === 'possessed') return possessedFace
  return (g, w, h) => {
    const cx = 256
    g.fillStyle = SKIN; g.fillRect(0, 0, w, h)
    const glow = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
    const bold = look === 'bulan', male = look === 'male', soft = look === 'plain' || male, scream = look === 'scream'
    // contour and blush
    ;[-1, 1].forEach(s => {
      glow(cx + s * 108, 300, 46, bold ? 'rgba(120,50,35,0.35)' : 'rgba(140,70,55,0.18)')
      if (!male) glow(cx + s * 92, 288, 38, bold ? 'rgba(200,70,70,0.32)' : soft ? 'rgba(225,130,120,0.18)' : 'rgba(225,120,115,0.32)')
    })
    glow(cx, 250, 26, 'rgba(255,235,215,0.25)')
    ;[-1, 1].forEach(s => {
      const ex = cx + s * 60, ey = 245
      // eyeshadow
      if (bold) { glow(ex + s * 4, ey - 10, 34, 'rgba(110,20,25,0.75)'); glow(ex, ey - 6, 20, 'rgba(214,160,70,0.55)') }
      else if (!soft) glow(ex, ey - 8, 28, 'rgba(120,80,60,0.45)')
      else glow(ex, ey - 8, 24, 'rgba(110,70,55,0.25)')
      // eye white
      g.fillStyle = '#f3ece4'
      g.beginPath(); g.moveTo(ex - s * 22, ey); g.quadraticCurveTo(ex, ey - 13, ex + s * 22, ey - 2); g.quadraticCurveTo(ex, ey + 9, ex - s * 22, ey); g.fill()
      // iris and pupil
      g.fillStyle = '#3a2216'; g.beginPath(); g.arc(ex + s * 1, ey - 2, 7.5, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#0d0605'; g.beginPath(); g.arc(ex + s * 1, ey - 2, 3.6, 0, Math.PI * 2); g.fill()
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(ex + s * 3, ey - 5, 1.8, 0, Math.PI * 2); g.fill()
      // upper liner, winged outward
      g.strokeStyle = '#0b0605'; g.lineCap = 'round'
      g.lineWidth = bold ? 4.5 : soft ? 2 : 3
      g.beginPath(); g.moveTo(ex - s * 23, ey + 1); g.quadraticCurveTo(ex, ey - 15, ex + s * 23, ey - 3)
      if (bold) g.lineTo(ex + s * 38, ey - 13); else if (!soft) g.lineTo(ex + s * 27, ey - 6)
      g.stroke()
      // lower lash line
      g.lineWidth = bold ? 2 : 1.2; g.strokeStyle = bold ? 'rgba(60,10,12,0.9)' : 'rgba(60,35,25,0.6)'
      g.beginPath(); g.moveTo(ex - s * 14, ey + 7); g.quadraticCurveTo(ex + s * 6, ey + 10, ex + s * 22, ey + 1); g.stroke()
      // lashes
      g.lineWidth = 1.4; g.strokeStyle = '#0b0605'
      if (!male) for (let k = 0; k < 6; k++) { const t = 0.45 + k * 0.1, lx = ex + s * (t * 46 - 23), ly = ey - 10 + Math.abs(t - 0.5) * 10; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + s * 4, ly - (bold ? 7 : 5)); g.stroke() }
      // brows
      g.strokeStyle = '#1a0f0b'; g.lineWidth = male ? 8 : bold ? 6 : 5
      const by = scream ? -10 : 0
      g.beginPath(); g.moveTo(ex - s * 24, 216 + by + (scream ? -6 : 0)); g.quadraticCurveTo(ex + s * 4, (bold ? 199 : male ? 208 : 203) + by, ex + s * 28, (bold ? 207 : male ? 212 : 210) + by); g.stroke()
    })
    // nose shading
    g.strokeStyle = 'rgba(120,70,50,0.35)'; g.lineWidth = 2
    g.beginPath(); g.moveTo(cx - 9, 238); g.quadraticCurveTo(cx - 12, 268, cx - 7, 283); g.stroke()
    g.fillStyle = 'rgba(110,60,45,0.4)'; g.beginPath(); g.ellipse(cx - 6, 285, 3, 2, 0, 0, Math.PI * 2); g.ellipse(cx + 6, 285, 3, 2, 0, 0, Math.PI * 2); g.fill()
    // lips
    if (scream) {
      g.fillStyle = '#5e1c1c'; g.beginPath(); g.ellipse(cx, 335, 30, 26, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#250606'; g.beginPath(); g.ellipse(cx, 338, 24, 20, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#f2ece2'; g.fillRect(cx - 18, 314, 36, 7)
      return
    }
    const lip = bold ? '#86161f' : male ? '#a5716a' : soft ? '#c07a72' : '#b25e5a', lipDark = bold ? '#550b12' : '#7d3a37'
    if (male) { g.strokeStyle = '#8a5550'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 26, 326); g.quadraticCurveTo(cx, 332, cx + 26, 326); g.stroke(); return }
    g.fillStyle = lip
    g.beginPath(); g.moveTo(cx - 34, 326); g.quadraticCurveTo(cx - 16, 313, cx, 319); g.quadraticCurveTo(cx + 16, 313, cx + 34, 326)
    g.quadraticCurveTo(cx, 348, cx - 34, 326); g.fill()
    g.strokeStyle = lipDark; g.lineWidth = 2.2
    g.beginPath(); g.moveTo(cx - 32, 326); g.quadraticCurveTo(cx, 330, cx + 32, 326); g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.ellipse(cx + 4, 334, 8, 2.5, 0, 0, Math.PI * 2); g.fill()
  }
}

function Head({ position, hairLen, hairFlare, tilt = 0, yaw = 0, partSide = 0, look = 'phim', children }) {
  const face = useMemo(() => canvasTex(1024, 512, makeupFace(look)), [look])
  const lipColor = look === 'bulan' ? '#86161f' : look === 'male' ? '#a5716a' : look === 'plain' ? '#c07a72' : '#b25e5a'
  const lips3D = look !== 'scream' && look !== 'male' && look !== 'possessed'

  const hairMat = <meshStandardMaterial color={HAIR} roughness={0.32} metalness={0.05} side={THREE.DoubleSide} />
  const [x, y, z] = position
  return (
    <group position={[x, y, z]} rotation={[tilt, yaw, 0]}>
      <mesh scale={[0.9, 1.15, 0.98]} castShadow>
        <sphereGeometry args={[0.185, 48, 36]} />
        <meshStandardMaterial map={face} roughness={0.55} />
      </mesh>
      <mesh position={[0, -0.028, 0.176]} scale={[0.75, 1.25, 0.9]}><sphereGeometry args={[0.022, 14, 10]} /><meshStandardMaterial color={SKIN} roughness={0.55} /></mesh>
      {lips3D && <mesh position={[0, -0.09, 0.168]} scale={[1.55, 0.5, 0.55]}><sphereGeometry args={[0.024, 16, 10]} /><meshStandardMaterial color={lipColor} roughness={0.3} /></mesh>}
      <mesh position={[0, 0.03, -0.015]} scale={[0.97, 1.12, 1.03]} rotation-x={-0.35} castShadow>
        <sphereGeometry args={[0.2, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {hairMat}
      </mesh>
      <mesh position={[0, 0.03, -0.015]} scale={[0.985, 1.135, 1.045]} rotation-x={-0.5} castShadow>
        <sphereGeometry args={[0.2, 32, 20, Math.PI * 0.8, Math.PI * 1.4, Math.PI * 0.45, Math.PI * 0.35]} />
        {hairMat}
      </mesh>
      {/* back curtain of straight hair */}
      {hairLen > 0 && <mesh position={[0, 0.04 - hairLen / 2, -0.02]} scale={[1, 1, 0.9]} castShadow>
        <cylinderGeometry args={[0.2, 0.2 + hairFlare, hairLen, 36, 1, true, Math.PI * 0.32, Math.PI * 1.36]} />
        {hairMat}
      </mesh>}
      {/* side part sweep */}
      {partSide !== 0 && (
        <mesh position={[partSide * -0.03, 0.2, 0.06]} rotation={[0.9, 0, partSide * 0.5]} scale={[1.3, 0.35, 0.6]}>
          <sphereGeometry args={[0.11, 16, 10]} />
          {hairMat}
        </mesh>
      )}
      {children}
    </group>
  )
}

function Boot({ position, rotation }) {
  const leather = <meshStandardMaterial color="#0c0b0c" roughness={0.28} metalness={0.1} />
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.07, 0]} castShadow><cylinderGeometry args={[0.105, 0.11, 0.24, 18]} />{leather}</mesh>
      <mesh position={[0, -0.07, 0.11]} castShadow><boxGeometry args={[0.17, 0.14, 0.3]} />{leather}</mesh>
      <mesh position={[0, -0.075, 0.26]} scale={[1, 0.8, 1]} castShadow><sphereGeometry args={[0.088, 16, 12]} />{leather}</mesh>
      <mesh position={[0, -0.16, 0.1]} castShadow><boxGeometry args={[0.2, 0.07, 0.4]} /><meshStandardMaterial color="#050505" roughness={0.95} /></mesh>
      {[-0.14, -0.06, 0.02, 0.1].map(zz => (
        <mesh key={zz} position={[0, -0.2, zz + 0.1]}><boxGeometry args={[0.2, 0.025, 0.035]} /><meshStandardMaterial color="#050505" roughness={1} /></mesh>
      ))}
      {[0, 0.06, 0.12].map((yy, i) => (
        <mesh key={i} position={[0, 0.0 + yy * 0.6, 0.11 - yy * 0.4]} rotation-x={-0.6}><boxGeometry args={[0.1, 0.012, 0.012]} /><meshStandardMaterial color="#3a3a3c" roughness={0.6} /></mesh>
      ))}
    </group>
  )
}

function Phim() {
  const white = '#f4f2ee', black = '#141317'
  const lean = -0.18
  const torsoZ = y => -0.05 - (y - 0.38) * Math.sin(-lean) + 0.165
  return (
    <group position={[-0.12, 0, 0.82]} rotation-y={0.1}>
      {/* pants */}
      <Limb a={[-0.15, 0.3, -0.02]} b={[0.15, 0.3, -0.02]} r={0.16} color={black} />
      <Limb a={[-0.16, 0.3, 0.02]} b={[-0.28, 0.86, 0.5]} r={0.118} color={black} />
      <Limb a={[-0.28, 0.86, 0.5]} b={[-0.3, 0.24, 0.84]} r={0.1} color={black} />
      <Boot position={[-0.3, 0.2, 0.86]} rotation={[0.25, 0.1, 0]} />
      <Limb a={[0.16, 0.28, 0.02]} b={[0.6, 0.2, 0.46]} r={0.118} color={black} />
      <Limb a={[0.6, 0.2, 0.46]} b={[0.16, 0.18, 0.86]} r={0.1} color={black} />
      <Boot position={[0.1, 0.2, 0.92]} rotation={[-Math.PI / 2 + 0.2, 0.5, 0]} />
      {/* belt */}
      <mesh position={[0, 0.42, -0.05]} rotation-x={Math.PI / 2 + lean} scale={[1.15, 0.78, 1]}><torusGeometry args={[0.2, 0.02, 8, 32]} /><meshStandardMaterial color="#0a0a0a" roughness={0.3} /></mesh>
      <mesh position={[0, 0.42, 0.115]}><boxGeometry args={[0.06, 0.04, 0.012]} /><meshStandardMaterial color="#b8b8b8" metalness={0.9} roughness={0.25} /></mesh>
      {/* shirt torso */}
      <LatheBody profile={[[0.2, 0], [0.205, 0.12], [0.2, 0.25], [0.215, 0.45], [0.225, 0.62], [0.21, 0.74], [0.15, 0.8], [0.09, 0.82], [0, 0.83]]}
        position={[0, 0.4, -0.05]} rotation={[lean, 0, 0]} scale={[1.15, 1, 0.78]} color={white} rough={0.72} />
      {[-1, 1].map(s => <mesh key={s} position={[s * 0.25, 1.1, -0.17]} castShadow><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color={white} roughness={0.72} /></mesh>)}
      {/* open collar */}
      <mesh position={[0, 1.1, torsoZ(1.1) - 0.005]} rotation-x={lean}><boxGeometry args={[0.08, 0.12, 0.01]} /><meshStandardMaterial color={SKIN} roughness={0.6} /></mesh>
      {[-1, 1].map(s => <Slab key={s} a={[s * 0.1, 1.19, torsoZ(1.19) - 0.05]} b={[s * 0.035, 1.03, torsoZ(1.03) + 0.01]} w={0.075} t={0.018} color={white} rough={0.7} />)}
      {[0.95, 0.8, 0.66, 0.52].map(y => (
        <mesh key={y} position={[0.012, y, torsoZ(y) + 0.008]}><sphereGeometry args={[0.012, 8, 6]} /><meshStandardMaterial color="#e2ddd2" roughness={0.4} /></mesh>
      ))}
      {/* lanyard and ID */}
      <Line points={[[-0.08, 1.2, torsoZ(1.2) - 0.05], [-0.03, 0.9, torsoZ(0.9) + 0.012], [0, 0.82, torsoZ(0.82) + 0.015]]} color="#0a0a0a" lineWidth={1.3} />
      <Line points={[[0.08, 1.2, torsoZ(1.2) - 0.05], [0.03, 0.9, torsoZ(0.9) + 0.012], [0, 0.82, torsoZ(0.82) + 0.015]]} color="#0a0a0a" lineWidth={1.3} />
      <group position={[0, 0.72, torsoZ(0.72) + 0.03]} rotation-x={lean}>
        <mesh castShadow><boxGeometry args={[0.13, 0.17, 0.014]} /><meshStandardMaterial color="#111114" roughness={0.35} /></mesh>
        <mesh position={[0, 0.035, 0.008]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.028, 0.028, 0.004, 20]} /><meshStandardMaterial color="#b9b9c0" metalness={0.8} roughness={0.3} /></mesh>
        {[-0.035, -0.055].map(yy => <mesh key={yy} position={[0, yy, 0.008]}><boxGeometry args={[0.08, 0.008, 0.002]} /><meshStandardMaterial color="#9a9aa2" /></mesh>)}
      </group>
      {/* right arm on raised knee, holding pistol */}
      <Limb a={[-0.25, 1.1, -0.17]} b={[-0.37, 0.82, 0.16]} r={0.088} color={white} rough={0.72} />
      <Limb a={[-0.37, 0.82, 0.16]} b={[-0.31, 0.84, 0.52]} r={0.078} color={white} rough={0.72} />
      <Limb a={[-0.315, 0.84, 0.5]} b={[-0.31, 0.84, 0.55]} r={0.082} color="#e8e5df" />
      <Hand position={[-0.3, 0.79, 0.62]} rotation={[0.9, 0, 0]} />
      <group position={[-0.3, 0.68, 0.66]} rotation={[0.15, 0, 0]}>
        <mesh castShadow><boxGeometry args={[0.04, 0.12, 0.07]} /><meshStandardMaterial color="#121212" roughness={0.5} /></mesh>
        <mesh position={[0, -0.13, 0.03]} castShadow><boxGeometry args={[0.042, 0.22, 0.05]} /><meshStandardMaterial color="#1b1b1d" metalness={0.5} roughness={0.35} /></mesh>
      </group>
      {/* left arm propping on floor */}
      <Limb a={[0.25, 1.1, -0.17]} b={[0.4, 0.68, -0.32]} r={0.088} color={white} rough={0.72} />
      <Limb a={[0.4, 0.68, -0.32]} b={[0.46, 0.2, -0.42]} r={0.078} color={white} rough={0.72} />
      <Limb a={[0.455, 0.24, -0.41]} b={[0.46, 0.19, -0.42]} r={0.082} color="#e8e5df" />
      <Hand position={[0.47, 0.06, -0.4]} scale={[0.065, 0.03, 0.085]} />
      {/* neck, head and shoulder-length hair */}
      <Limb a={[0, 1.15, -0.19]} b={[0, 1.3, -0.2]} r={0.072} color={SKIN} />
      <Head position={[0, 1.47, -0.19]} hairLen={0.44} hairFlare={0.03} tilt={-0.05} partSide={1} look="phim" />
      {[-1, 1].map(s => (
        <group key={s}>
          <Slab a={[s * 0.165, 1.55, -0.12]} b={[s * 0.19, 1.32, -0.1]} w={0.08} t={0.045} color={HAIR} rough={0.32} />
          <Slab a={[s * 0.19, 1.32, -0.1]} b={[s * 0.21, 1.12, -0.1]} w={0.1} t={0.04} color={HAIR} rough={0.32} />
        </group>
      ))}
    </group>
  )
}

function bandeauFolds(g, w, h) {
  g.fillStyle = '#8a1d22'; g.fillRect(0, 0, w, h)
  for (let i = -h; i < w + h; i += 14) {
    g.strokeStyle = 'rgba(40,0,5,0.45)'; g.lineWidth = 4
    g.beginPath(); g.moveTo(i, 0); g.quadraticCurveTo(i + h * 0.25, h * 0.5, i + h * 0.1, h); g.stroke()
    g.strokeStyle = 'rgba(255,140,140,0.12)'; g.lineWidth = 2
    g.beginPath(); g.moveTo(i + 6, 0); g.quadraticCurveTo(i + 6 + h * 0.25, h * 0.5, i + 6 + h * 0.1, h); g.stroke()
  }
}
function goldBorder(g, w, h) {
  g.fillStyle = '#b7863a'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#5a1714'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h)
  for (let y = 0; y < h; y += 26) {
    g.fillStyle = '#e2bc6e'
    g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w - 22, y + 13); g.lineTo(w / 2, y + 26); g.lineTo(22, y + 13); g.closePath(); g.fill()
    g.fillStyle = '#7a2a1c'; g.beginPath(); g.arc(w / 2, y + 13, 4, 0, Math.PI * 2); g.fill()
  }
  g.strokeStyle = '#5a1714'; g.lineWidth = 2
  for (let x = 16; x < w - 10; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 1 }
}

function Bulan() {
  const skirtTex = useMemo(() => canvasTex(256, 256, skirtPattern, [2, 1.5]), [])
  const lapTex = useMemo(() => canvasTex(256, 256, skirtPattern, [1, 1]), [])
  const foldTex = useMemo(() => canvasTex(256, 64, bandeauFolds, [2, 1]), [])
  const borderTex = useMemo(() => canvasTex(64, 256, goldBorder, [1, 2]), [])
  const shawl = '#6a1418'
  const bz = -0.47
  const female = [[0.15, 0], [0.155, 0.12], [0.165, 0.25], [0.185, 0.36], [0.205, 0.45], [0.19, 0.56], [0.19, 0.65], [0.205, 0.72], [0.16, 0.77], [0.08, 0.8], [0, 0.81]]
  return (
    <group position={[0.65, 0, 0]} rotation-y={-0.08}>
      {/* hips and lap in patterned pha nung */}
      <mesh position={[0, 0.94, bz - 0.02]} scale={[1.28, 0.62, 1.0]} castShadow><sphereGeometry args={[0.2, 24, 16]} /><meshStandardMaterial map={lapTex} roughness={0.5} /></mesh>
      {[-1, 1].map(s => <Limb key={s} a={[s * 0.1, 0.87, bz - 0.04]} b={[s * 0.09, 0.85, 0.02]} r={0.12} color="#5a1714" />)}
      <mesh position={[0, 0.9, -0.22]} castShadow><boxGeometry args={[0.22, 0.2, 0.48]} /><meshStandardMaterial map={lapTex} roughness={0.5} /></mesh>
      <mesh position={[0, 0.43, 0.1]} scale={[1, 1, 0.8]} castShadow>
        <cylinderGeometry args={[0.25, 0.32, 0.86, 28, 1, true]} />
        <meshStandardMaterial map={skirtTex} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* gold border panel down the front */}
      <Slab a={[0, 0.985, -0.4]} b={[0, 0.975, 0.06]} w={0.17} t={0.012} map={borderTex} rough={0.35} metal={0.35} />
      <Slab a={[0, 0.975, 0.06]} b={[0, 0.84, 0.31]} w={0.17} t={0.012} map={borderTex} rough={0.35} metal={0.35} />
      <Slab a={[0, 0.84, 0.31]} b={[0, 0.02, 0.37]} w={0.17} t={0.012} map={borderTex} rough={0.35} metal={0.35} />
      {/* bare feet */}
      {[-1, 1].map(s => <Limb key={s} a={[s * 0.07, 0.035, 0.3]} b={[s * 0.075, 0.03, 0.44]} r={0.036} color={SKIN} />)}
      {/* waistband */}
      <mesh position={[0, 1.02, bz]} rotation-x={Math.PI / 2} scale={[1.15, 0.85, 1]}><torusGeometry args={[0.16, 0.022, 8, 32]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      {/* torso, bare midriff */}
      <LatheBody profile={female} position={[0, 1.0, bz]} scale={[1.15, 1, 0.82]} color={SKIN} rough={0.55} />
      {/* twisted red bandeau */}
      <LatheBody profile={[[0.198, 0.36], [0.218, 0.42], [0.22, 0.5], [0.205, 0.56]]} position={[0, 1.0, bz]} scale={[1.16, 1, 0.84]} map={foldTex} rough={0.6} />
      {[0.5, -0.5].map(r => (
        <mesh key={r} position={[0, 1.46, bz + 0.19]} rotation={[0, 0, r]} scale={[1.4, 0.8, 0.7]}><torusGeometry args={[0.035, 0.022, 10, 20]} /><meshStandardMaterial color="#7a1a1f" roughness={0.6} /></mesh>
      ))}
      {/* gold collar and layered chains */}
      <mesh position={[0, 1.735, bz + 0.005]} scale={[1.05, 1, 0.85]}>
        <cylinderGeometry args={[0.095, 0.17, 0.06, 32, 1, true]} />
        <meshStandardMaterial color={GOLD} metalness={0.9} roughness={0.22} side={THREE.DoubleSide} />
      </mesh>
      {[[0.13, 1.66, 0.35], [0.16, 1.6, 0.42]].map(([r, y, tilt], i) => (
        <mesh key={i} position={[0, y, bz + 0.03]} rotation-x={Math.PI / 2 - tilt} scale={[1.1, 0.8, 1]}><torusGeometry args={[r, 0.006, 6, 40]} /><meshStandardMaterial color={GOLD} metalness={0.95} roughness={0.2} /></mesh>
      ))}
      {/* arms resting, hands folded on lap */}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[s * 0.25, 1.68, bz]} castShadow><sphereGeometry args={[0.08, 14, 10]} /><meshStandardMaterial color={SKIN} roughness={0.55} /></mesh>
          <Limb a={[s * 0.26, 1.68, bz]} b={[s * 0.3, 1.27, bz + 0.09]} r={0.066} color={SKIN} rough={0.55} />
          <Limb a={[s * 0.3, 1.27, bz + 0.09]} b={[s * 0.07, 1.04, -0.12]} r={0.056} color={SKIN} rough={0.55} />
          <Bangle at={[s * 0.1, 1.06, -0.15]} dir={[s * -0.23, -0.23, 0.36]} />
          <Hand position={[s * 0.035, 1.02, -0.08]} rotation={[0.2, s * 0.6, 0]} scale={[0.055, 0.032, 0.075]} />
        </group>
      ))}
      {/* red shawl over the left forearm, pooling on the floor */}
      <Slab a={[0.2, 1.12, -0.2]} b={[0.4, 0.62, 0.02]} w={0.28} t={0.035} color={shawl} rough={0.75} />
      <Slab a={[0.4, 0.62, 0.02]} b={[0.46, 0.04, 0.24]} w={0.34} t={0.035} color={shawl} rough={0.75} />
      <mesh position={[0.52, 0.02, 0.36]} rotation-y={-0.4} scale={[1, 0.12, 1]} castShadow receiveShadow><sphereGeometry args={[0.24, 18, 10]} /><meshStandardMaterial color={shawl} roughness={0.75} /></mesh>
      {/* neck, head, waist-length hair */}
      <Limb a={[0, 1.76, bz]} b={[0, 1.9, bz]} r={0.066} color={SKIN} rough={0.55} />
      <Head position={[0, 2.06, bz + 0.01]} hairLen={1.02} hairFlare={0.07} look="bulan" />
      {[-1, 1].map(s => (
        <group key={s}>
          <Slab a={[s * 0.16, 2.12, bz + 0.08]} b={[s * 0.2, 1.7, bz + 0.14]} w={0.1} t={0.045} color={HAIR} rough={0.32} />
          <Slab a={[s * 0.2, 1.7, bz + 0.14]} b={[s * 0.205, 1.3, bz + 0.17]} w={0.11} t={0.04} color={HAIR} rough={0.32} />
        </group>
      ))}
    </group>
  )
}

/* ---------- falling petals ---------- */
function Petals({ on }) {
  const ref = useRef()
  const N = 180
  const data = useMemo(() => {
    const r = rnd(9)
    return Array.from({ length: N }, () => ({
      x: (r() - 0.5) * 9, y: r() * 6, z: (r() - 0.5) * 6.5, s: 0.25 + r() * 0.35, rx: r() * 6, ry: r() * 6, k: r(),
    }))
  }, [])
  const obj = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    const c = new THREE.Color()
    data.forEach((d, i) => ref.current.setColorAt(i, c.set(d.k > 0.5 ? '#f2a024' : '#e46a1c')))
    ref.current.instanceColor.needsUpdate = true
  }, [data])
  useFrame((_, dt) => {
    if (!ref.current) return
    ref.current.visible = on
    if (!on) return
    data.forEach((d, i) => {
      d.y -= d.s * dt
      d.rx += dt * 1.6; d.ry += dt * 1.1
      if (d.y < 0.02) d.y = 5.6
      obj.position.set(d.x + Math.sin(d.y * 2 + d.k * 6) * 0.15, d.y, d.z)
      obj.rotation.set(d.rx, d.ry, 0)
      obj.updateMatrix()
      ref.current.setMatrixAt(i, obj.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[null, null, N]}>
      <circleGeometry args={[0.045, 6]} />
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.8} />
    </instancedMesh>
  )
}

/* ================= SCENE 2: the puppet room ================= */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function sarongPattern(g, w, h) {
  g.fillStyle = '#e6dccb'; g.fillRect(0, 0, w, h)
  g.strokeStyle = 'rgba(150,120,85,0.35)'; g.lineWidth = 1.5
  for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(x + 8, y + 2); g.lineTo(x + 14, y + 8); g.lineTo(x + 8, y + 14); g.lineTo(x + 2, y + 8); g.closePath(); g.stroke() }
}

function plaid(g, w, h) {
  g.fillStyle = '#d3cdc2'; g.fillRect(0, 0, w, h)
  for (let i = 0; i < w; i += 32) {
    g.fillStyle = 'rgba(120,118,112,0.35)'; g.fillRect(i, 0, 9, h); g.fillRect(0, i, w, 9)
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(i + 16, 0, 3, h); g.fillRect(0, i + 16, w, 3)
    g.fillStyle = 'rgba(80,78,74,0.3)'; g.fillRect(i + 24, 0, 2, h); g.fillRect(0, i + 24, w, 2)
  }
}
function OpenShell({ a, b, r0, r1, map, gap = 0.55 }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
    const d = B.clone().sub(A)
    return { pos: A.clone().add(B).multiplyScalar(0.5).toArray(), quat: new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), len: d.length() }
  }, [a.join(), b.join()])
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[r1, r0, len, 32, 1, true, gap, Math.PI * 2 - gap * 2]} />
      <meshStandardMaterial map={map} roughness={0.8} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Figure({ position, rotY = 0, j, top, overshirt, torsoR = 0.19, sleeve = 'long', bottom, legsColor, skirt, shoes, socks, barefoot, footBack, head, extras }) {
  const legLow = legsColor || bottom
  const torsoA = add(j.hip, [0, 0.05, 0]), torsoB = add(j.neck, [0, -0.08, 0])
  return (
    <group position={position} rotation-y={rotY}>
      <Limb a={torsoA} b={torsoB} r={torsoR} color={top} rough={0.7} />
      {overshirt && <OpenShell a={add(j.hip, [0, -0.02, 0])} b={add(j.neck, [0, 0.02, 0])} r0={torsoR + 0.05} r1={torsoR + 0.035} map={overshirt} />}
      <Limb a={j.hp[0]} b={j.hp[1]} r={torsoR * 0.78} color={skirt ? skirt.color || '#ffffff' : bottom} />
      <Limb a={add(j.neck, [0, -0.06, 0])} b={add(j.head, [0, -0.15, 0])} r={0.062} color={SKIN} />
      {[0, 1].map(i => {
        const fore = sleeve === 'long' ? top : SKIN
        const cut = sleeve === '3q' ? mid(j.el[i], j.ha[i], 0.45) : j.el[i]
        return (
          <group key={i}>
            <mesh position={j.sh[i]} castShadow><sphereGeometry args={[torsoR * (overshirt ? 0.52 : 0.45), 14, 10]} /><meshStandardMaterial color={overshirt ? '#ffffff' : top} map={overshirt || null} roughness={0.7} /></mesh>
            <Limb a={j.sh[i]} b={j.el[i]} r={overshirt ? 0.082 : 0.07} color={sleeve === 'short' ? SKIN : top} map={overshirt} rough={0.7} />
            {sleeve === 'short' && <Limb a={j.sh[i]} b={mid(j.sh[i], j.el[i], 0.45)} r={0.078} color={top} rough={0.7} />}
            {sleeve === '3q' && <Limb a={j.el[i]} b={cut} r={0.064} color={top} rough={0.7} />}
            <Limb a={cut} b={j.ha[i]} r={overshirt ? 0.07 : 0.058} color={sleeve === 'long' ? fore : SKIN} map={overshirt} rough={0.6} />
            <mesh position={j.ha[i]} scale={[0.055, 0.075, 0.035]} castShadow><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color={SKIN} roughness={0.6} /></mesh>
            <Limb a={j.hp[i]} b={j.kn[i]} r={0.098} color={skirt && skirt.len !== 'seated' ? SKIN : bottom} />
            <Limb a={j.kn[i]} b={j.an[i]} r={0.078} color={socks && false ? socks : (skirt ? SKIN : legLow)} />
            {socks && <Limb a={mid(j.kn[i], j.an[i], 0.7)} b={j.an[i]} r={0.081} color={socks} />}
            {barefoot
              ? <Limb a={add(j.an[i], [0, -0.05, footBack ? 0.04 : -0.02])} b={add(j.an[i], [0, -0.07, footBack ? -0.16 : 0.15])} r={0.04} color={SKIN} />
              : <mesh position={add(j.an[i], [0, -0.04, footBack ? -0.07 : 0.07])} castShadow><boxGeometry args={[0.13, 0.1, 0.25]} /><meshStandardMaterial color={shoes} roughness={0.4} /></mesh>}
          </group>
        )
      })}
      {skirt && skirt.len === 'long' && (
        <mesh position={[0, (j.hip[1] + 0.08 + 0.05) / 2, 0.01]} castShadow>
          <cylinderGeometry args={[0.2, 0.27, j.hip[1] + 0.08 - 0.05, 28, 1, true]} />
          <meshStandardMaterial color={skirt.map ? '#ffffff' : skirt.color} map={skirt.map || null} roughness={0.75} side={THREE.DoubleSide} />
        </mesh>
      )}
      {skirt && skirt.len === 'knee' && (
        <mesh position={[0, (j.hip[1] + 0.08 + j.kn[0][1] - 0.06) / 2, 0.01]} castShadow>
          <cylinderGeometry args={[0.2, 0.27, j.hip[1] + 0.08 - (j.kn[0][1] - 0.06), 28, 1, true]} />
          <meshStandardMaterial color={skirt.color} roughness={0.75} side={THREE.DoubleSide} />
        </mesh>
      )}
      {skirt && skirt.len === 'seated' && <Limb a={j.hip} b={mid(j.kn[0], j.kn[1])} r={0.19} color={skirt.color} rough={0.75} />}
      <Head position={j.head} hairLen={head.hairLen ?? 0} hairFlare={head.flare ?? 0.03} tilt={head.tilt || 0} yaw={head.yaw || 0} partSide={head.part || 0} look={head.look}>
        {head.bun && <mesh position={[0, 0.0, -0.2]} castShadow><sphereGeometry args={[0.09, 16, 12]} /><meshStandardMaterial color={HAIR} roughness={0.35} /></mesh>}
        {head.pony && (
          <group>
            <mesh position={[0, 0.12, -0.19]}><sphereGeometry args={[0.05, 12, 10]} /><meshStandardMaterial color={HAIR} roughness={0.3} /></mesh>
            <Limb a={[0, 0.1, -0.23]} b={[0, -0.12, -0.29]} r={0.05} color={HAIR} rough={0.3} />
            <Limb a={[0, -0.12, -0.29]} b={[0.02, -0.42, -0.27]} r={0.04} color={HAIR} rough={0.3} />
          </group>
        )}
        {head.strands && [-1, 1].map(k => (
          <group key={'st' + k}>
            <Slab a={[k * 0.16, 0.06, 0.07]} b={[k * 0.2, -0.36, 0.13]} w={0.1} t={0.045} color={HAIR} rough={0.32} />
            <Slab a={[k * 0.2, -0.36, 0.13]} b={[k * 0.205, -0.78, 0.15]} w={0.11} t={0.04} color={HAIR} rough={0.32} />
          </group>
        ))}
        {head.earrings && [-1, 1].map(k => <mesh key={k} position={[k * 0.168, -0.06, 0.0]} rotation-y={Math.PI / 2}><torusGeometry args={[0.018, 0.004, 6, 16]} /><meshStandardMaterial color="#d8d8dc" metalness={0.95} roughness={0.2} /></mesh>)}
        {head.glasses && (
          <group position={[0, 0.015, 0.178]}>
            {[-1, 1].map(s => <mesh key={s} position={[s * 0.065, 0, 0]}><torusGeometry args={[0.045, 0.007, 6, 24]} /><meshStandardMaterial color="#1a1a1a" roughness={0.4} /></mesh>)}
            <mesh><boxGeometry args={[0.04, 0.008, 0.008]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
          </group>
        )}
      </Head>
      {extras}
    </group>
  )
}

const P = {
  stand: { hip: [0, 1.22, 0], neck: [0, 1.98, 0], head: [0, 2.26, 0.01], sh: [[-0.23, 1.9, 0], [0.23, 1.9, 0]], el: [[-0.27, 1.55, 0.02], [0.27, 1.55, 0.02]], ha: [[-0.25, 1.2, 0.06], [0.25, 1.2, 0.06]], hp: [[-0.11, 1.18, 0], [0.11, 1.18, 0]], kn: [[-0.12, 0.66, 0.02], [0.12, 0.66, 0.02]], an: [[-0.12, 0.1, 0], [0.12, 0.1, 0]] },
}
P.tray = { ...P.stand, el: [[-0.27, 1.58, 0.18], [0.27, 1.58, 0.18]], ha: [[-0.17, 1.45, 0.38], [0.17, 1.45, 0.38]] }
P.scared = { ...P.stand, el: [[-0.25, 1.58, 0.15], [0.25, 1.58, 0.15]], ha: [[-0.07, 1.86, 0.2], [0.07, 1.82, 0.22]] }
P.lean = { ...P.stand, neck: [0, 1.97, 0.08], head: [0, 2.24, 0.16], sh: [[-0.24, 1.9, 0.06], [0.24, 1.9, 0.06]], el: [[-0.28, 1.55, 0.06], [0.32, 1.6, 0.2]], ha: [[-0.26, 1.2, 0.08], [0.3, 1.28, 0.42]] }
P.crouch = { hip: [0, 0.55, -0.15], neck: [0, 1.28, 0.14], head: [0, 1.54, 0.24], sh: [[-0.27, 1.24, 0.1], [0.27, 1.24, 0.1]], el: [[-0.3, 0.96, 0.4], [0.3, 0.96, 0.4]], ha: [[-0.14, 0.84, 0.68], [0.14, 0.84, 0.68]], hp: [[-0.14, 0.53, -0.15], [0.14, 0.53, -0.15]], kn: [[-0.23, 0.78, 0.3], [0.23, 0.78, 0.3]], an: [[-0.2, 0.1, 0.06], [0.2, 0.1, 0.06]] }
P.kneel = { hip: [0, 0.62, 0], neck: [0, 1.36, 0.12], head: [0, 1.62, 0.18], sh: [[-0.23, 1.3, 0.1], [0.23, 1.3, 0.1]], el: [[-0.3, 1.0, 0.35], [0.3, 1.0, 0.35]], ha: [[-0.12, 0.86, 0.55], [0.12, 0.86, 0.55]], hp: [[-0.11, 0.6, 0], [0.11, 0.6, 0]], kn: [[-0.13, 0.12, 0.4], [0.13, 0.12, 0.4]], an: [[-0.12, 0.1, -0.22], [0.12, 0.1, -0.22]] }
P.thrash = { hip: [0, 0.3, 0], neck: [0, 0.95, -0.32], head: [0, 1.17, -0.42], sh: [[-0.22, 0.9, -0.3], [0.22, 0.9, -0.3]], el: [[-0.55, 0.72, -0.05], [0.36, 0.62, -0.1]], ha: [[-0.85, 0.45, 0.22], [0.22, 0.58, 0.22]], hp: [[-0.1, 0.28, 0], [0.1, 0.28, 0]], kn: [[-0.15, 0.48, 0.45], [0.15, 0.42, 0.48]], an: [[-0.14, 0.1, 0.85], [0.17, 0.1, 0.88]] }

function Pan({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, -0.12, 0]}><cylinderGeometry args={[0.1, 0.14, 0.05, 24]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      <mesh position={[0, -0.06, 0]}><cylinderGeometry args={[0.05, 0.06, 0.1, 16]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      <mesh position={[0, 0.0, 0]}><cylinderGeometry args={[0.26, 0.2, 0.06, 28]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      <mesh position={[0, 0.03, 0]} scale={[1, 0.45, 1]}><sphereGeometry args={[0.24, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#b3141c" roughness={0.6} /></mesh>
    </group>
  )
}

function CrownSpire({ position, s = 1, color = GOLD }) {
  const geo = useMemo(() => new THREE.LatheGeometry([[0.1, 0], [0.11, 0.05], [0.07, 0.1], [0.085, 0.16], [0.05, 0.24], [0.06, 0.3], [0.025, 0.42], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 18), [])
  return <mesh geometry={geo} position={position} scale={s} castShadow><meshStandardMaterial color={color} metalness={0.8} roughness={0.3} /></mesh>
}

function KhonMask({ position, face, s = 1 }) {
  return (
    <group position={position} scale={s}>
      <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.1, 0.13, 0.06, 18]} /><meshStandardMaterial color="#3a2414" roughness={0.6} /></mesh>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.025, 0.03, 0.14, 10]} /><meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0, 0.3, 0]} scale={[0.9, 1.1, 0.9]} castShadow><sphereGeometry args={[0.12, 20, 16]} /><meshStandardMaterial color={face} roughness={0.45} metalness={0.2} /></mesh>
      <mesh position={[0, 0.39, 0]}><cylinderGeometry args={[0.115, 0.115, 0.04, 20]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      <CrownSpire position={[0, 0.41, 0]} s={1.1} />
      {[-1, 1].map(k => <mesh key={k} position={[k * 0.13, 0.36, 0]} rotation-z={-k * 0.5}><coneGeometry args={[0.015, 0.16, 6]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>)}
    </group>
  )
}

function KhonStatue({ position, robe, face = '#d6a14a', s = 1, rotY = 0 }) {
  return (
    <group position={position} scale={s} rotation-y={rotY}>
      <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.36, 0.06, 0.3]} /><meshStandardMaterial color="#3a2414" /></mesh>
      {[-1, 1].map(k => <Limb key={k} a={[k * 0.07, 0.1, 0]} b={[k * 0.08, 0.5, 0]} r={0.04} color={robe} />)}
      <mesh position={[0, 0.62, 0]} castShadow><cylinderGeometry args={[0.13, 0.17, 0.32, 16]} /><meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, 0.92, 0]} castShadow><cylinderGeometry args={[0.15, 0.12, 0.34, 16]} /><meshStandardMaterial color={robe} roughness={0.5} metalness={0.2} /></mesh>
      <mesh position={[0, 1.1, 0]} scale={[1, 0.4, 1]}><sphereGeometry args={[0.2, 16, 10]} /><meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.3} /></mesh>
      {[-1, 1].map(k => <Limb key={k} a={[k * 0.18, 1.05, 0]} b={[k * 0.26, 0.72, 0.08]} r={0.035} color={robe} />)}
      <mesh position={[0, 1.24, 0]} castShadow><sphereGeometry args={[0.085, 16, 12]} /><meshStandardMaterial color={face} roughness={0.45} metalness={0.2} /></mesh>
      <CrownSpire position={[0, 1.3, 0]} s={0.75} />
    </group>
  )
}

function Puppet({ position, robe, face = '#e6c08a', s = 1 }) {
  return (
    <group position={position} scale={s}>
      <mesh position={[0, 0.18, 0]} castShadow><coneGeometry args={[0.16, 0.36, 16]} /><meshStandardMaterial color={robe} roughness={0.55} metalness={0.15} /></mesh>
      <mesh position={[0, 0.38, 0]}><sphereGeometry args={[0.06, 14, 10]} /><meshStandardMaterial color={face} roughness={0.5} /></mesh>
      <CrownSpire position={[0, 0.42, 0]} s={0.5} />
    </group>
  )
}

function Books({ x0, x1, y, z, seed }) {
  const ref = useRef()
  const items = useMemo(() => {
    const r = rnd(seed), out = []
    let x = x0
    while (x < x1 - 0.06) { const w = 0.05 + r() * 0.05, h = 0.26 + r() * 0.14; out.push([x + w / 2, h, w, r()]); x += w + 0.005 + (r() < 0.08 ? 0.12 : 0) }
    return out
  }, [x0, x1, seed])
  useEffect(() => {
    const m = new THREE.Matrix4(), c = new THREE.Color(), cols = ['#7b2b23', '#2f4a5e', '#c9b48a', '#3c5a3b', '#d9d2c3', '#8a6a2f', '#5a3550']
    items.forEach(([x, h, w, k], i) => {
      m.compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, 0.32))
      ref.current.setMatrixAt(i, m); ref.current.setColorAt(i, c.set(cols[Math.floor(k * cols.length)]))
    })
    ref.current.instanceMatrix.needsUpdate = true; ref.current.instanceColor.needsUpdate = true
  }, [items])
  return <instancedMesh ref={ref} args={[null, null, items.length]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={0.8} /></instancedMesh>
}

function Shelf({ x, w, h, d = 0.5, z = -3.35, rows, seed, dark = '#4a2c18' }) {
  return (
    <group>
      <mesh position={[x, h / 2, z - d / 2 + 0.02]} receiveShadow><boxGeometry args={[w, h, 0.04]} /><meshStandardMaterial color={dark} roughness={0.7} /></mesh>
      {[-1, 1].map(k => <mesh key={k} position={[x + k * (w / 2 - 0.02), h / 2, z]} castShadow><boxGeometry args={[0.04, h, d]} /><meshStandardMaterial color="#6b4426" roughness={0.6} /></mesh>)}
      {rows.map((y, i) => (
        <group key={i}>
          <mesh position={[x, y, z]} castShadow receiveShadow><boxGeometry args={[w, 0.035, d]} /><meshStandardMaterial color="#6b4426" roughness={0.6} /></mesh>
          {i < rows.length - 1 && <Books x0={x - w / 2 + 0.05} x1={x + w / 2 - 0.05} y={y + 0.018} z={z + 0.02} seed={seed + i} />}
        </group>
      ))}
    </group>
  )
}

function Cabinet({ x, w, h, z = -3.3, d = 0.6 }) {
  const doors = Math.round(w / 0.68)
  return (
    <group>
      <mesh position={[x, h / 2, z]} castShadow receiveShadow><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#5a3820" roughness={0.55} /></mesh>
      <mesh position={[x, h + 0.02, z]} castShadow><boxGeometry args={[w + 0.06, 0.04, d + 0.06]} /><meshStandardMaterial color="#6e4728" roughness={0.5} /></mesh>
      {Array.from({ length: doors }, (_, i) => {
        const dx = x - w / 2 + (w / doors) * (i + 0.5)
        return (
          <mesh key={i} position={[dx, h * 0.5, z + d / 2 + 0.005]}><boxGeometry args={[w / doors - 0.08, h - 0.2, 0.01]} /><meshStandardMaterial color="#1b1612" roughness={0.1} metalness={0.4} /></mesh>
        )
      })}
    </group>
  )
}

function Room2() {
  const floor = useMemo(() => canvasTex(512, 512, woodBoards(false, '#6a4529', 3), [2, 2]), [])
  const wall = useMemo(() => canvasTex(512, 512, woodBoards(true, '#7c5435', 5), [2.4, 1.4]), [])
  const win = <meshBasicMaterial color={[2.6, 2.6, 2.4]} toneMapped={false} />
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[10, 7.4]} /><meshStandardMaterial map={floor} roughness={0.45} /></mesh>
      <mesh position={[0, -0.262, 0]}><boxGeometry args={[10.4, 0.5, 7.8]} /><meshStandardMaterial color="#1b130e" roughness={0.9} /></mesh>
      <mesh position={[0, 2.75, -3.7]} receiveShadow><boxGeometry args={[10, 5.5, 0.12]} /><meshStandardMaterial map={wall} roughness={0.8} /></mesh>
      <mesh position={[-5, 2.75, 0]} rotation-y={Math.PI / 2} receiveShadow><boxGeometry args={[7.4, 5.5, 0.12]} /><meshStandardMaterial map={wall} roughness={0.8} /></mesh>
      {/* windows */}
      <mesh position={[-3.0, 4.35, -3.63]}><planeGeometry args={[3.2, 1.6]} />{win}</mesh>
      {[-4.2, -3.4, -2.6, -1.8].map(x => <mesh key={x} position={[x, 4.35, -3.6]}><boxGeometry args={[0.06, 1.6, 0.04]} /><meshStandardMaterial color="#2a2018" /></mesh>)}
      <mesh position={[-3.0, 4.35, -3.6]}><boxGeometry args={[3.2, 0.06, 0.04]} /><meshStandardMaterial color="#2a2018" /></mesh>
      <mesh position={[3.7, 3.5, -3.63]}><planeGeometry args={[2.0, 2.6]} />{win}</mesh>
      {[2.85, 3.55, 4.25].map(x => <mesh key={x} position={[x, 3.5, -3.58]}><boxGeometry args={[0.5, 2.6, 0.03]} /><meshStandardMaterial color="#b0703e" roughness={0.8} /></mesh>)}
      {[[1.4, 4.75, 0.9, 0.6], [2.6, 4.9, 0.7, 0.5]].map(([x, y, w, h], i) => (
        <group key={i} position={[x, y, -3.6]}>
          <mesh><boxGeometry args={[w, h, 0.05]} /><meshStandardMaterial color="#2a1a10" roughness={0.5} /></mesh>
          <mesh position={[0, 0, 0.03]}><planeGeometry args={[w - 0.12, h - 0.12]} /><meshStandardMaterial color="#8c7a5c" roughness={0.9} /></mesh>
        </group>
      ))}
      {/* tall shelf with archive boxes, left */}
      <Shelf x={-4.1} w={1.5} h={3.4} rows={[0.05, 0.85, 1.65, 2.45, 3.3]} seed={20} />
      {[[-4.5, 2.47], [-3.9, 2.47], [-4.3, 3.32], [-3.75, 3.32]].map(([x, y], i) => <mesh key={i} position={[x, y + 0.2, -3.33]} castShadow><boxGeometry args={[0.5, 0.4, 0.42]} /><meshStandardMaterial color="#b49b74" roughness={0.9} /></mesh>)}
      {/* centre bookshelf topped with khon figures */}
      <Shelf x={-0.95} w={2.6} h={1.6} rows={[0.05, 0.55, 1.05, 1.58]} seed={40} />
      <KhonStatue position={[-1.7, 1.6, -3.35]} robe="#7a3b22" s={1.25} />
      <KhonStatue position={[-0.9, 1.6, -3.35]} robe="#a8823a" s={1.35} />
      <KhonStatue position={[-0.15, 1.6, -3.35]} robe="#2f4a3c" s={0.6} />
      <Puppet position={[0.15, 1.6, -3.3]} robe="#7e1f2a" s={0.9} />
      {/* long glass cabinet, right, with masks and rod puppets */}
      <Cabinet x={2.85} w={4.1} h={1.35} />
      {[[1.15, '#2e7a4c', 1.1], [1.75, '#d8b24a', 1], [2.3, '#b03a2e', 1.15], [2.95, '#e8e2d2', 1], [3.55, '#2c4f8f', 1.1], [4.2, '#1d1d1d', 1.2]].map(([x, f, s], i) => (
        <KhonMask key={i} position={[x, 1.39, -3.3]} face={f} s={s} />
      ))}
      {[[1.45, '#5a1e3e'], [2.62, '#2b3f6b'], [3.25, '#7d5a1f'], [3.9, '#7a1a1a'], [4.6, '#3d2a52']].map(([x, c], i) => <Puppet key={i} position={[x, 1.39, -3.15]} robe={c} s={1.25} />)}
    </group>
  )
}

const SKIRT_CREAM = { len: 'long' }
function World2() {
  const sarong = useMemo(() => canvasTex(256, 256, sarongPattern, [3, 3]), [])
  const plaidTex = useMemo(() => canvasTex(256, 256, plaid, [2, 2]), [])
  return (
    <>
      <color attach="background" args={['#14130f']} />
      <fog attach="fog" args={['#14130f', 16, 32]} />
      <ambientLight intensity={0.55} color="#d9ddd4" />
      <hemisphereLight intensity={0.35} color="#e8eadf" groundColor="#2a1c10" />
      <directionalLight position={[-4, 8, -7]} intensity={2.2} color="#fff3df" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0004} />
      <directionalLight position={[4, 4, 8]} intensity={0.7} color="#cfd8e6" />
      <pointLight position={[-3, 4.2, -2.6]} intensity={6} distance={8} color="#fff1d8" />
      <Room2 />
      {/* Mae Khru Bulan: white Thai blouse, long cream sarong, low bun, barefoot */}
      <Figure position={[-1.6, 0, 0.2]} rotY={1.0} j={P.stand} top="#efebe3" sleeve="3q" skirt={{ len: 'long', map: sarong }} barefoot head={{ look: 'bulan', bun: true, yaw: 0.35, tilt: 0.08 }} />
      {/* assistant with offering tray */}
      <Figure position={[-2.8, 0, 0.6]} rotY={0.4} j={P.tray} top="#6b5440" bottom="#1e1c1c" skirt={{ len: 'knee', color: '#1e1c1c' }} barefoot head={{ look: 'plain', hairLen: 0.62, flare: 0.04 }} extras={<Pan position={[0, 1.5, 0.42]} />} />
      {/* frightened students */}
      <Figure position={[-4.0, 0, 0.9]} rotY={0.6} j={P.scared} top="#f1efe9" sleeve="short" bottom="#1d2433" skirt={{ len: 'knee', color: '#1d2433' }} socks="#f1efe9" shoes="#141414" head={{ look: 'plain', hairLen: 0.5 }} />
      <Figure position={[-3.55, 0, 1.75]} rotY={0.45} j={P.scared} top="#f1efe9" sleeve="short" bottom="#1d2433" skirt={{ len: 'knee', color: '#1d2433' }} socks="#f1efe9" shoes="#141414" head={{ look: 'plain', hairLen: 0.35, part: -1 }} />
      {/* teacher in grey shirt leaning in */}
      <Figure position={[1.35, 0, -0.8]} rotY={-0.15} j={P.lean} top="#8d9294" torsoR={0.21} bottom="#1c1c1f" shoes="#111" head={{ look: 'male', tilt: 0.3, glasses: true }} />
      {/* big man crouching in black vest */}
      <Figure position={[0.15, 0, 0.8]} rotY={1.05} j={P.crouch} top="#c9a98a" torsoR={0.25} bottom="#7c6e58" shoes="#2a2420" head={{ look: 'male', tilt: 0.25 }}
        extras={<Limb a={[0, 0.62, -0.12]} b={[0, 1.16, 0.11]} r={0.262} color="#141416" rough={0.8} />} />
      {/* woman in beige kneeling behind */}
      <Figure position={[0.75, 0, 0.15]} rotY={0.25} j={P.kneel} top="#c8b294" bottom="#5c4a38" shoes="#3a2c20" footBack head={{ look: 'plain', hairLen: 0.4, tilt: 0.15 }} />
      {/* possessed student screaming */}
      <Figure position={[1.15, 0, 1.05]} rotY={-0.4} j={P.thrash} top="#f2f0ea" sleeve="short" bottom="#1d2433" skirt={{ len: 'seated', color: '#1d2433' }} socks="#f1efe9" shoes="#141414" head={{ look: 'possessed', hairLen: 0.22, tilt: -0.35, yaw: 0.25 }}
        extras={<>
          {[-1, 1].map(k => Array.from({ length: 9 }, (_, i) => {
            const t = i / 8
            return <mesh key={k + '' + i} position={[k * (0.15 + Math.sin(t * 3) * 0.03), 1.1 - t * 0.5, -0.38 + t * 0.34]} castShadow><sphereGeometry args={[0.04 - t * 0.012, 10, 8]} /><meshStandardMaterial color={HAIR} roughness={0.35} /></mesh>
          }))}
          <mesh position={[0, 0.9, -0.11]}><sphereGeometry args={[0.035, 10, 8]} /><meshStandardMaterial color="#0d0d10" roughness={0.6} /></mesh>
          <Slab a={[-0.01, 0.9, -0.1]} b={[-0.06, 0.68, 0.03]} w={0.06} t={0.012} color="#0d0d10" rough={0.6} />
          <Slab a={[0.01, 0.9, -0.1]} b={[0.05, 0.66, 0.04]} w={0.06} t={0.012} color="#0d0d10" rough={0.6} />
        </>} />
      {/* Lt. Phim kneeling, holding her */}
      <Figure position={[1.45, 0, 0.42]} rotY={-0.4} j={P.kneel} top="#151517" overshirt={plaidTex} bottom="#a9bccb" shoes="#eeeeea" footBack head={{ look: 'phim', pony: true, earrings: true, tilt: 0.1, yaw: -0.2 }}
        extras={<>
          <mesh position={[0, 1.2, 0.235]} rotation-x={0.25} scale={[1, 0.6, 0.35]}><sphereGeometry args={[0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={SKIN} roughness={0.6} /></mesh>
          <Line points={[[-0.07, 1.33, 0.17], [-0.02, 1.08, 0.29], [0, 1.0, 0.3], [0.02, 1.08, 0.29], [0.07, 1.33, 0.17]]} color="#0a0a0a" lineWidth={1.4} />
        </>} />
      <ContactShadows position={[0, 0.015, 0]} opacity={0.55} scale={12} blur={2.2} far={3} />
    </>
  )
}

const OVERVIEW2 = { cam: [1.9, 3.9, 11.2], look: [1.3, 1.35, -0.3] }
const SPOTS2 = [
  { th: 'แม่ครูบุหลัน', en: 'Mae Khru Bulan', pos: [-1.6, 2.75, 0.2], look: [-0.9, 1.75, 0.35], cam: [1.4, 2.3, 3.6], cast: 'บิ๊นท์ สิรีธร ลีห์อร่ามวัฒน์', quote: 'ผู้หมวดจะไม่เชื่อฉันไม่เคยว่า แต่อย่ามาขัดพิธีของฉัน ถือว่าไม่ให้เกียรติครูบาอาจารย์ของฉันและวิชาของฉัน ถึงคราตัวเองจะเดือดร้อน แม้แต่ฉันก็มิอาจช่วยได้', to: 'หมวดภีม' },
  { th: 'หมวดภีม', en: 'Police Lt. Phim', pos: [1.45, 2.05, 0.42], look: [1.25, 1.1, 0.7], cam: [3.0, 1.45, 3.0], cast: 'ปุยนุ่น วรางค์ศิริ ธนจรัสวรภัทร์', quote: 'งั้นก็ช่วยพิสูจน์ให้ฉันเห็นดิ ฉันเองก็อยากจะรู้เหมือนกันว่า ถ้าเกิดผีมันมีจริง คุณจะสามารถช่วยปราบผีได้จริงไหม', to: 'แม่ครูบุหลัน' },
]
const LINE2 = { who: 'แม่ครูบุหลัน', to: 'หมวดภีม', text: 'ผู้หมวดจะไม่เชื่อฉันไม่เคยว่า แต่อย่ามาขัดพิธีของฉัน ถือว่าไม่ให้เกียรติครูบาอาจารย์ของฉันและวิชาของฉัน' }

/* ================= SCENE 3: the forest at night ================= */
function yantTattoo(g, w, h) {
  g.clearRect(0, 0, w, h)
  g.strokeStyle = 'rgba(70,30,20,0.85)'; g.fillStyle = 'rgba(70,30,20,0.85)'; g.lineCap = 'round'
  const cx = w * 0.62, cy = h * 0.82
  g.lineWidth = 3
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI * 0.95 + i * (Math.PI * 0.62 / 12)
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * (120 + (i % 2) * 18), cy + Math.sin(a) * (120 + (i % 2) * 18)); g.stroke()
  }
  ;[150, 172, 194].forEach((r, k) => {
    g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, -Math.PI * 0.98, -Math.PI * 0.3); g.stroke()
    for (let a = -Math.PI * 0.96; a < -Math.PI * 0.32; a += 0.06) {
      const rr = r + 10
      g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.2, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (rr - 4), cy + Math.sin(a) * (rr - 4)); g.lineTo(cx + Math.cos(a + 0.02) * (rr + 4), cy + Math.sin(a + 0.02) * (rr + 4)); g.stroke()
    }
  })
}
function goldSarong(g, w, h) {
  g.fillStyle = '#cdb68a'; g.fillRect(0, 0, w, h)
  for (let y = 0; y < h; y += 32) {
    g.strokeStyle = 'rgba(140,110,60,0.6)'; g.lineWidth = 2
    g.beginPath()
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + 16 + Math.sin(x / 8) * 5)
    g.stroke()
    g.fillStyle = 'rgba(150,118,62,0.45)'
    for (let x = 6; x < w; x += 16) { g.beginPath(); g.arc(x, y + 4, 2, 0, Math.PI * 2); g.fill() }
  }
}
function laceTex(g, w, h) {
  g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, w, h)
  g.fillStyle = 'rgba(190,182,165,0.55)'
  for (let x = 0; x < w; x += 20) for (let y = 0; y < h; y += 20) {
    const o = (y / 20) % 2 ? 10 : 0
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 0.4; g.beginPath(); g.arc(x + o + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 1.6, 0, Math.PI * 2); g.fill() }
  }
}
function groundTex(g, w, h) {
  g.fillStyle = '#1b1d12'; g.fillRect(0, 0, w, h)
  const r = rnd(5)
  for (let i = 0; i < 2200; i++) { g.fillStyle = r() > 0.5 ? 'rgba(52,60,30,0.6)' : 'rgba(30,22,14,0.6)'; g.fillRect(r() * w, r() * h, 2 + r() * 4, 1 + r() * 3) }
}

function Fire({ points, n = 160, spread = 0.25, height = 0.55 }) {
  const ref = useRef(), embers = useRef()
  const data = useMemo(() => {
    const r = rnd(77)
    return Array.from({ length: n }, () => {
      const t = r(), seg = Math.min(points.length - 2, Math.floor(t * (points.length - 1)))
      const lt = t * (points.length - 1) - seg
      const p = mid(points[seg], points[seg + 1], lt)
      return { x: p[0] + (r() - 0.5) * spread, z: p[2] + (r() - 0.5) * spread, h: height * (0.4 + r() * (p[1] > 0 ? 1.8 : 1)), base: p[1], ph: r() * 10, sp: 6 + r() * 6, k: r() }
    })
  }, [])
  const em = useMemo(() => { const r = rnd(12); return Array.from({ length: 70 }, () => ({ i: Math.floor(r() * n), t: r(), v: 0.4 + r() * 0.6, dx: (r() - 0.5) * 0.3 })) }, [])
  const obj = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    const c = new THREE.Color()
    data.forEach((d, i) => ref.current.setColorAt(i, c.setRGB(4 + d.k * 2, 1.4 + d.k * 1.2, 0.3)))
    ref.current.instanceColor.needsUpdate = true
  }, [data])
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    data.forEach((d, i) => {
      const f = 0.7 + Math.sin(t * d.sp + d.ph) * 0.2 + Math.sin(t * d.sp * 2.3 + d.ph) * 0.12
      obj.position.set(d.x + Math.sin(t * 3 + d.ph) * 0.02, d.base + (d.h * f) / 2, d.z)
      obj.scale.set(0.55 + d.k * 0.5, d.h * f / 0.5, 0.55 + d.k * 0.5)
      obj.rotation.set(0, d.ph, Math.sin(t * 4 + d.ph) * 0.12)
      obj.updateMatrix(); ref.current.setMatrixAt(i, obj.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
    em.forEach((e, i) => {
      e.t += dt * e.v * 0.5; if (e.t > 1) e.t -= 1
      const d = data[e.i]
      obj.position.set(d.x + e.dx * e.t + Math.sin(t * 2 + i) * 0.05, d.base + 0.2 + e.t * 2.2, d.z)
      obj.scale.setScalar(0.012 * (1 - e.t) + 0.004); obj.rotation.set(0, 0, 0)
      obj.updateMatrix(); embers.current.setMatrixAt(i, obj.matrix)
    })
    embers.current.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      <instancedMesh ref={ref} args={[null, null, n]}>
        <coneGeometry args={[0.07, 0.5, 6, 1, true]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.32} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={embers} args={[null, null, 70]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color={[5, 2, 0.5]} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

function FireLights() {
  const a = useRef(), b = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (a.current) a.current.intensity = 5 + Math.sin(t * 11) * 1.5 + Math.sin(t * 23) * 1
    if (b.current) b.current.intensity = 3.5 + Math.sin(t * 13 + 1) * 1.2
  })
  return (
    <>
      <pointLight ref={a} position={[2.6, 1.0, -0.2]} color="#ff8a3a" distance={9} decay={1.6} />
      <pointLight ref={b} position={[0.7, 0.5, 0.15]} color="#ff9a40" distance={7} decay={1.7} />
    </>
  )
}

function Forest() {
  const ground = useMemo(() => canvasTex(512, 512, groundTex, [2, 2]), [])
  const trees = useMemo(() => {
    const r = rnd(31), out = []
    for (let i = 0; i < 34; i++) {
      let x = (r() - 0.5) * 9.6, z = -3.6 + r() * 7.2
      if (z > -1.4 && Math.abs(x) < 3.9) z = -1.6 - r() * 2
      out.push({ x, z, h: 4.2 + r() * 1.8, r: 0.07 + r() * 0.12, lean: (r() - 0.5) * 0.08 })
    }
    return out
  }, [])
  const grassRef = useRef()
  const grass = useMemo(() => {
    const r = rnd(8), out = []
    for (let i = 0; i < 700; i++) {
      const x = (r() - 0.5) * 9.8, z = (r() - 0.5) * 7.2
      if (Math.abs(x) < 3.4 && z > -1.0 && z < 2.6 && r() < 0.85) continue
      out.push([x, z, 0.15 + r() * 0.45, r()])
    }
    return out
  }, [])
  useEffect(() => {
    const o = new THREE.Object3D(), c = new THREE.Color()
    grass.forEach(([x, z, h, k], i) => {
      o.position.set(x, h / 2, z); o.scale.set(1, h / 0.4, 1); o.rotation.set((k - 0.5) * 0.4, k * 6, (k - 0.5) * 0.3); o.updateMatrix()
      grassRef.current.setMatrixAt(i, o.matrix); grassRef.current.setColorAt(i, c.set(k > 0.5 ? '#25351a' : '#1a2614'))
    })
    grassRef.current.instanceMatrix.needsUpdate = true; grassRef.current.instanceColor.needsUpdate = true
  }, [grass])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[10, 7.4]} /><meshStandardMaterial map={ground} roughness={0.95} /></mesh>
      <mesh position={[0, -0.262, 0]}><boxGeometry args={[10.4, 0.5, 7.8]} /><meshStandardMaterial color="#120d09" roughness={0.9} /></mesh>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation-z={t.lean}>
          <mesh position={[0, t.h / 2, 0]} castShadow><cylinderGeometry args={[t.r * 0.7, t.r, t.h, 10]} /><meshStandardMaterial color="#2a2119" roughness={0.95} /></mesh>
          {[0, 1, 2].map(k => (
            <mesh key={k} position={[(k - 1) * 0.35, t.h - 0.2 + k * 0.15, (k % 2) * 0.2]} castShadow><icosahedronGeometry args={[0.55 + (i % 3) * 0.12, 1]} /><meshStandardMaterial color="#141c11" roughness={1} flatShading /></mesh>
          ))}
        </group>
      ))}
      <instancedMesh ref={grassRef} args={[null, null, grass.length]}><coneGeometry args={[0.03, 0.4, 4]} /><meshStandardMaterial roughness={1} /></instancedMesh>
    </group>
  )
}

function Pearls({ pts, r = 0.011 }) {
  return pts.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[r, 8, 6]} /><meshStandardMaterial color="#f4efe4" roughness={0.25} metalness={0.2} /></mesh>)
}
function pearlCurve(a, b, sagDepth, n) { return sag(a, b, sagDepth, n) }

function World3() {
  const sarong = useMemo(() => canvasTex(256, 256, goldSarong, [2, 3]), [])
  const lace = useMemo(() => canvasTex(256, 256, laceTex, [3, 3]), [])
  const tattoo = useMemo(() => { const t = canvasTex(512, 512, yantTattoo); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t }, [])
  const red = '#5e1416', shawl = '#6a1418'
  const bulanJ = { ...P.stand, el: [[-0.27, 1.55, 0.04], [0.59, 2.15, 0.51]], ha: [[-0.24, 1.2, 0.1], [0.25, 2.26, 0.68]], head: [0, 2.28, 0.0] }
  const ghostJ = { hip: [0, 0.98, 0], neck: [0, 1.6, 0.42], head: [0, 1.78, 0.62], sh: [[-0.23, 1.55, 0.36], [0.23, 1.55, 0.36]], el: [[-0.3, 1.15, 0.5], [0.3, 1.15, 0.52]], ha: [[-0.26, 0.8, 0.58], [0.26, 0.82, 0.6]], hp: [[-0.11, 0.95, 0], [0.11, 0.95, 0]], kn: [[-0.14, 0.55, 0.22], [0.14, 0.55, 0.22]], an: [[-0.13, 0.1, 0], [0.13, 0.1, 0]] }
  return (
    <>
      <color attach="background" args={['#040605']} />
      <fog attach="fog" args={['#040605', 9, 22]} />
      <ambientLight intensity={0.14} color="#9fb2c8" />
      <directionalLight position={[-3, 7, -6]} intensity={0.9} color="#a9bed8" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0004} />
      <spotLight position={[-1.5, 6, 4]} angle={0.4} penumbra={0.8} intensity={14} distance={14} color="#e9ecf2" target-position={[-2.2, 1, 0.3]} />
      <FireLights />
      <Forest />
      {/* the two women, turned toward the ghost */}
      <group position={[-2.2, 0, 0.35]} rotation-y={1.15}>
        {/* woman in white lace, eyes covered */}
        <Figure position={[0, 0, 0]} j={P.stand} top="#ffffff" overshirt={null} sleeve="long" skirt={{ len: 'long', map: sarong }} barefoot head={{ look: 'plain', hairLen: 0.75, flare: 0.05 }}
          extras={<>
            <OpenShell a={[0, 1.15, 0]} b={[0, 1.95, 0]} r0={0.25} r1={0.215} map={lace} gap={0.35} />
            {[-1, 1].map(k => <Limb key={k} a={[k * 0.23, 1.9, 0]} b={[k * 0.28, 1.2, 0.08]} r={0.078} map={lace} color="#fff" />)}
            {[-1, 1].map(k => <mesh key={'b' + k} position={[k * 0.05, 1.35, 0.22]} scale={[1.3, 0.8, 0.5]}><sphereGeometry args={[0.04, 10, 8]} /><meshStandardMaterial color="#f3f0e8" roughness={0.7} /></mesh>)}
            <Pearls pts={pearlCurve([-0.08, 2.0, 0.1], [0.08, 2.0, 0.1], 0.06, 12).map(p => [p[0], p[1], p[2] + 0.04])} />
            <Pearls pts={pearlCurve([-0.09, 1.99, 0.08], [0.09, 1.99, 0.08], 0.42, 34).map((p, i, arr) => [p[0], p[1], p[2] + 0.1 * Math.sin(Math.PI * i / (arr.length - 1))])} r={0.009} />
          </>} />
        {/* Mae Khru Bulan behind her, hand over her eyes */}
        <Figure position={[-0.3, 0, -0.42]} rotY={0.15} j={bulanJ} top={SKIN} sleeve="short" skirt={{ len: 'long', color: red }} barefoot head={{ look: 'bulan', hairLen: 1.05, flare: 0.08, strands: true, yaw: 0 }}
          extras={<>
            <mesh position={[0, 1.7, 0]}><cylinderGeometry args={[0.215, 0.205, 0.22, 24, 1, true]} /><meshStandardMaterial color="#6e1a1e" roughness={0.65} side={THREE.DoubleSide} /></mesh>
            <mesh position={[-0.06, 1.85, 0.192]}><planeGeometry args={[0.26, 0.26]} /><meshStandardMaterial map={tattoo} transparent roughness={0.6} depthWrite={false} polygonOffset polygonOffsetFactor={-2} /></mesh>
            <mesh position={[0.59, 2.15, 0.51]}><sphereGeometry args={[0.075, 12, 10]} /><meshStandardMaterial color={SKIN} roughness={0.55} /></mesh>
            <Limb a={[0.25, 2.26, 0.68]} b={[0.24, 2.28, 0.72]} r={0.05} color={SKIN} rough={0.55} />
            <group position={[0.24, 2.28, 0.72]} rotation={[0, -0.15, -0.15]}>
              <mesh scale={[0.1, 0.055, 0.028]} castShadow><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color={SKIN} roughness={0.55} /></mesh>
              {[0.045, 0.015, -0.015, -0.045].map((y, i) => <Limb key={i} a={[-0.06, y * 0.9, 0.005]} b={[-0.15 + Math.abs(y) * 0.6, y, 0.0]} r={0.013} color={SKIN} rough={0.55} />)}
              {[0.045, 0.015, -0.015, -0.045].map((y, i) => <mesh key={'n' + i} position={[-0.15 + Math.abs(y) * 0.6, y, 0.008]}><sphereGeometry args={[0.011, 8, 6]} /><meshStandardMaterial color="#3a0a10" roughness={0.25} /></mesh>)}
            </group>
          </>} />
      </group>
      {/* the ghost, burning, with a trail of fire across the ground */}
      <Figure position={[2.7, 0, -0.35]} rotY={-1.6} j={ghostJ} top="#cfc6b2" bottom="#3a2c20" skirt={{ len: 'long', color: '#4a3a2a' }} barefoot head={{ look: 'plain', hairLen: 0.8, flare: 0.1, tilt: 0.55 }}
        extras={<Slab a={[0, 1.9, 0.78]} b={[0.02, 1.3, 0.86]} w={0.3} t={0.04} color={HAIR} rough={0.5} />} />
      <Fire points={[[2.9, 0, -0.3], [2.2, 0, -0.15], [1.5, 0, 0.0], [0.8, 0, 0.12], [0.2, 0, 0.2]]} n={115} />
      <Fire points={[[2.5, 0.3, -0.5], [2.75, 0.6, -0.3], [2.6, 0.9, -0.2], [2.85, 0.3, -0.15]]} n={60} spread={0.4} height={0.5} />
      <ContactShadows position={[0, 0.015, 0]} opacity={0.6} scale={12} blur={2.4} far={3} />
    </>
  )
}

const OVERVIEW3 = { cam: [0.7, 2.7, 9.0], look: [1.0, 1.25, 0.0] }
const SPOTS3 = [
  { th: 'แม่ครูบุหลัน', en: 'Mae Khru Bulan', pos: [-2.73, 2.75, 0.45], look: [-2.58, 1.35, 0.55], cam: [-0.98, 1.8, 5.1], cast: 'บิ๊นท์ สิรีธร ลีห์อร่ามวัฒน์', quote: 'กูไม่ให้! มึงกลับไปอยู่ที่ของมึง ไม่ว่าผีตนใดริแตะต้อง เมื่อนั้นกูจะเผาดวงวิญญาณให้สิ้นซาก', to: 'วิญญาณร้าย' },
]

/* ================= SCENE 4: the bedroom ================= */
function bedTex(g, w, h) {
  g.fillStyle = '#b8352c'; g.fillRect(0, 0, w, h)
  const r = rnd(14)
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = r() > 0.5 ? 'rgba(90,15,12,0.25)' : 'rgba(230,110,95,0.18)'; g.lineWidth = 2 + r() * 4
    g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 60, x + (r() - 0.5) * 200, y + (r() - 0.5) * 80); g.stroke()
  }
}
function lourveTex(g, w, h) {
  g.fillStyle = '#5a3a22'; g.fillRect(0, 0, w, h)
  for (let y = 12; y < h - 12; y += 9) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(14, y, w - 28, 3); g.fillStyle = 'rgba(255,200,150,0.08)'; g.fillRect(14, y + 3, w - 28, 2) }
  g.strokeStyle = '#3d2614'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10)
}
function netTex(g, w, h) {
  g.clearRect(0, 0, w, h)
  g.fillStyle = 'rgba(245,244,240,0.55)'; g.fillRect(0, 0, w, h)
  for (let x = 0; x < w; x += 6) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + 0.2 * Math.abs(Math.sin(x / 13))) + ')'; g.fillRect(x, 0, 3, h) }
  g.strokeStyle = 'rgba(200,200,195,0.6)'; g.lineWidth = 2
  for (let y = 40; y < h; y += 90) for (let x = 30; x < w; x += 80) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.arc(x + 14, y + 6, 7, 0, Math.PI * 2); g.stroke() }
}

function Scalloped({ position, w, h, rotY = 0 }) {
  const geo = useMemo(() => {
    const sh = new THREE.Shape()
    sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h)
    const n = 5
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + (w / n) * i, x1 = x0 + w / n
      sh.quadraticCurveTo((x0 + x1) / 2, h + 0.12 * (i % 2 ? -1 : 1), x1, h)
    }
    sh.lineTo(w / 2, 0); sh.closePath()
    return new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 })
  }, [w, h])
  return <mesh geometry={geo} position={position} rotation-y={rotY} castShadow receiveShadow><meshStandardMaterial color="#6b3a1e" roughness={0.45} /></mesh>
}

function Lamp({ position, h = 0.42 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.1, 0.12, 0.06, 18]} /><meshStandardMaterial color="#7a6a55" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.02, 0.02, 0.2, 8]} /><meshStandardMaterial color="#7a6a55" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[0, 0.24 + h / 2, 0]}><cylinderGeometry args={[0.13, 0.15, h, 24]} /><meshBasicMaterial color={[3.2, 2.4, 1.5]} toneMapped={false} /></mesh>
      <pointLight position={[0, 0.3 + h / 2, 0.15]} color="#ffbe7a" intensity={5} distance={7} decay={1.5} />
    </group>
  )
}

function Bedroom() {
  const floor = useMemo(() => canvasTex(512, 512, woodBoards(false, '#4a2615', 9), [2, 2]), [])
  const wall = useMemo(() => canvasTex(512, 512, woodBoards(true, '#5c341c', 13), [2.4, 1.4]), [])
  const bed = useMemo(() => canvasTex(256, 256, bedTex, [2, 2]), [])
  const door = useMemo(() => canvasTex(128, 256, lourveTex), [])
  const net = useMemo(() => canvasTex(256, 256, netTex, [1, 1]), [])
  const wood = <meshStandardMaterial color="#5e321a" roughness={0.45} />
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[10, 7.4]} /><meshStandardMaterial map={floor} roughness={0.4} /></mesh>
      <mesh position={[0, -0.262, 0]}><boxGeometry args={[10.4, 0.5, 7.8]} /><meshStandardMaterial color="#1b130e" roughness={0.9} /></mesh>
      <mesh position={[0, 2.75, -3.7]} receiveShadow><boxGeometry args={[10, 5.5, 0.12]} /><meshStandardMaterial map={wall} roughness={0.75} /></mesh>
      <mesh position={[-5, 2.75, 0]} rotation-y={Math.PI / 2} receiveShadow><boxGeometry args={[7.4, 5.5, 0.12]} /><meshStandardMaterial map={wall} roughness={0.75} /></mesh>
      {/* framed panels on the back wall */}
      {[-3.6, -1.9, 2.3, 3.9].map(x => (
        <group key={x} position={[x, 2.2, -3.62]}>
          <mesh><boxGeometry args={[1.3, 2.4, 0.04]} /><meshStandardMaterial color="#6a3d22" roughness={0.6} /></mesh>
          <mesh position={[0, 0, 0.03]}><boxGeometry args={[1.1, 2.2, 0.02]} /><meshStandardMaterial color="#4e2a15" roughness={0.7} /></mesh>
        </group>
      ))}
      {[-4.4, -2.7, -1.1, 1.4, 3.1, 4.7].map(x => <mesh key={x} position={[x, 2.75, -3.58]} castShadow><boxGeometry args={[0.16, 5.5, 0.14]} />{wood}</mesh>)}
      {/* doorway with louvred door */}
      <mesh position={[0.15, 1.35, -3.6]}><boxGeometry args={[1.25, 2.7, 0.06]} /><meshStandardMaterial color="#e9dfcc" roughness={0.8} /></mesh>
      <mesh position={[0.32, 1.27, -3.4]} rotation-y={-0.5}><boxGeometry args={[0.95, 2.5, 0.05]} /><meshStandardMaterial map={door} roughness={0.6} /></mesh>
      <mesh position={[0.15, 1.27, -3.56]}><planeGeometry args={[1.05, 2.5]} /><meshStandardMaterial color="#1a120b" /></mesh>
      {/* nightstands and lamps */}
      <mesh position={[-1.6, 0.4, -2.9]} castShadow receiveShadow><boxGeometry args={[0.8, 0.8, 0.6]} />{wood}</mesh>
      <Lamp position={[-1.6, 0.8, -2.9]} />
      <mesh position={[2.4, 0.55, -2.9]} castShadow receiveShadow><boxGeometry args={[0.8, 1.1, 0.6]} />{wood}</mesh>
      <Lamp position={[2.4, 1.1, -2.9]} h={0.5} />
      {/* bed: footboard left, scalloped headboard right, red bedding */}
      <mesh position={[0.4, 0.22, -0.5]} castShadow receiveShadow><boxGeometry args={[3.4, 0.24, 2.0]} />{wood}</mesh>
      <mesh position={[0.4, 0.42, -0.5]} castShadow receiveShadow><boxGeometry args={[3.36, 0.18, 1.98]} /><meshStandardMaterial map={bed} roughness={0.85} /></mesh>
      <mesh position={[0.4, 0.33, 0.53]} receiveShadow><boxGeometry args={[3.36, 0.2, 0.04]} /><meshStandardMaterial map={bed} roughness={0.85} /></mesh>
      {[[2.15, 0.8], [-1.35, 0.8]].map(([x, h0], i) => (
        <group key={i}>
          <Scalloped position={[x, 0.1, -0.5]} w={2.0} h={h0} rotY={Math.PI / 2} />
          {[0.5, -1.5].map(z => <mesh key={z} position={[x, (h0 + 0.35) / 2, z]} castShadow><boxGeometry args={[0.12, h0 + 0.35, 0.12]} />{wood}</mesh>)}
          {[0.5, -1.5].map(z => <mesh key={'k' + z} position={[x, h0 + 0.42, z]}><sphereGeometry args={[0.07, 12, 10]} />{wood}</mesh>)}
        </group>
      ))}
      {[[1.7, -0.95], [1.7, -0.05]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.62, z]} rotation-z={0.35} scale={[0.32, 0.18, 0.7]} castShadow><sphereGeometry args={[0.6, 24, 16]} /><meshStandardMaterial color="#b42f27" roughness={0.75} /></mesh>
      ))}
      {/* mosquito net / sheer curtain at the head of the bed */}
      {[0.45, 1.2, 1.95, 2.7].map((x, i) => (
        <mesh key={i} position={[2.75 + i * 0.12, 2.4, -2.2 + x]} rotation-y={Math.PI / 2 + (i % 2 ? 0.2 : -0.2)}>
          <planeGeometry args={[0.85, 4.6]} />
          <meshStandardMaterial map={net} transparent opacity={0.75} side={THREE.DoubleSide} depthWrite={false} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[3.0, 4.75, -0.5]}><boxGeometry args={[0.06, 0.06, 3.2]} />{wood}</mesh>
    </group>
  )
}

function World4() {
  const PH = { hip: [0, 0.62, 0], neck: [0, 1.34, -0.02], head: [0, 1.61, 0.0], sh: [[-0.23, 1.27, -0.01], [0.23, 1.27, -0.01]], el: [[-0.28, 0.94, 0.05], [0.5, 1.1, 0.12]], ha: [[-0.27, 0.66, 0.16], [0.78, 0.98, 0.2]], hp: [[-0.11, 0.6, 0], [0.11, 0.6, 0]], kn: [[-0.14, 0.6, 0.45], [0.14, 0.6, 0.45]], an: [[-0.14, 0.1, 0.52], [0.14, 0.1, 0.52]] }
  const BU = { hip: [0, 0.62, 0], neck: [0, 1.32, 0.06], head: [0, 1.58, 0.12], sh: [[-0.23, 1.25, 0.03], [0.23, 1.25, 0.03]], el: [[-0.32, 1.0, 0.36], [0.3, 0.94, 0.24]], ha: [[-0.15, 1.15, 0.67], [0.05, 0.97, 0.46]], hp: [[-0.11, 0.6, 0], [0.11, 0.6, 0]], kn: [[-0.13, 0.6, 0.42], [0.13, 0.6, 0.42]], an: [[-0.27, 0.58, 0.12], [-0.02, 0.58, 0.1]] }
  return (
    <>
      <color attach="background" args={['#0d0907']} />
      <fog attach="fog" args={['#0d0907', 14, 28]} />
      <ambientLight intensity={0.3} color="#ffd6ae" />
      <hemisphereLight intensity={0.25} color="#ffe3c2" groundColor="#2a1408" />
      <directionalLight position={[6, 6, 3]} intensity={1.3} color="#dfe6f0" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0004} />
      <pointLight position={[0.3, 2.6, 2.4]} intensity={4} distance={8} color="#ffd9b0" />
      <Bedroom />
      {/* Lt. Phim on the edge of the bed, arm held out */}
      <Figure position={[-0.35, 0, 0.2]} j={PH} top="#9ea4a8" sleeve="short" bottom="#16171d" barefoot head={{ look: 'phim', pony: true, yaw: 0.55, tilt: 0.05 }}
        extras={<>
          <mesh position={[0, 0.66, 0]} rotation-x={Math.PI / 2} scale={[1.18, 0.85, 1]}><torusGeometry args={[0.19, 0.022, 8, 32]} /><meshStandardMaterial color="#3a2618" roughness={0.4} /></mesh>
          <mesh position={[0, 0.66, 0.165]}><boxGeometry args={[0.07, 0.045, 0.012]} /><meshStandardMaterial color="#c8c8cc" metalness={0.9} roughness={0.25} /></mesh>
          <Bangle at={[0.72, 1.0, 0.185]} dir={[1, -0.4, 0.25]} r={0.062} color="#101012" />
          <mesh position={[0.72, 1.06, 0.19]} rotation-z={-0.4}><boxGeometry args={[0.045, 0.01, 0.05]} /><meshStandardMaterial color="#1c1c20" metalness={0.5} roughness={0.2} /></mesh>
        </>} />
      {/* Mae Khru Bulan kneeling beside her, wiping her arm */}
      <Figure position={[0.85, 0, 0.2]} rotY={-1.2} j={BU} top="#f3f1ec" sleeve="short" bottom="#cfccc4" barefoot head={{ look: 'bulan', bun: true, tilt: 0.35, yaw: 0.1 }}
        extras={<>
          <mesh position={[0, 1.33, 0.07]} rotation-x={Math.PI / 2 - 0.15}><torusGeometry args={[0.08, 0.025, 8, 24]} /><meshStandardMaterial color="#f6f4ef" roughness={0.8} /></mesh>
          <mesh position={[0, 1.24, 0.2]}><sphereGeometry args={[0.012, 8, 6]} /><meshStandardMaterial color="#d8d2c4" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[-0.13, 1.16, 0.72]} scale={[1.2, 0.7, 1]} castShadow><icosahedronGeometry args={[0.075, 1]} /><meshStandardMaterial color="#f7f6f2" roughness={0.95} flatShading /></mesh>
        </>} />
      <ContactShadows position={[0, 0.015, 0]} opacity={0.5} scale={12} blur={2.4} far={3} />
    </>
  )
}

const OVERVIEW4 = { cam: [0.4, 2.3, 6.4], look: [0.35, 1.0, -0.3] }
const SPOTS4 = [
  { th: 'หมวดภีม', en: 'Police Lt. Phim', pos: [-0.35, 2.0, 0.2], look: [0.05, 1.2, 0.25], cam: [0.6, 1.6, 2.9], cast: 'ปุยนุ่น วรางค์ศิริ ธนจรัสวรภัทร์', quote: 'คุณตั้งใจจะหลบหน้าฉันหรอ', to: 'แม่ครูบุหลัน' },
  { th: 'แม่ครูบุหลัน', en: 'Mae Khru Bulan', pos: [0.85, 2.0, 0.2], look: [0.45, 1.15, 0.3], cam: [-0.5, 1.6, 2.8], cast: 'บิ๊นท์ สิรีธร ลีห์อร่ามวัฒน์', quote: 'คนอย่างฉันไม่คิดหลบหลีก แต่ฉันร่วมหลับนอนกับผู้ที่มีฤทธิ์สุราไม่ได้ และใช้ชีวิตร่วมกับคนที่มีศีลไม่เสมอกันไม่ได้', to: 'หมวดภีม' },
]

/* ================= SCENE 5: the temple hall ================= */
function goldCarve(g, w, h) {
  g.fillStyle = '#3a1d0e'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#c8962f'; g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h)
  for (let y = 10; y < h; y += 48) {
    g.fillStyle = '#d9a83c'
    g.beginPath(); g.moveTo(w / 2, y); g.bezierCurveTo(w - 10, y + 6, w - 12, y + 30, w / 2, y + 44); g.bezierCurveTo(12, y + 30, 10, y + 6, w / 2, y); g.fill()
    g.fillStyle = '#7a4a14'; g.beginPath(); g.arc(w / 2, y + 22, 7, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#f0c45a'; g.lineWidth = 2
    ;[-1, 1].forEach(s => { g.beginPath(); g.moveTo(w / 2 + s * 8, y + 22); g.quadraticCurveTo(w / 2 + s * 22, y + 8, w / 2 + s * 18, y + 40); g.stroke() })
  }
}
function polishedFloor(g, w, h) {
  const r = rnd(33)
  for (let i = 0; i < 12; i++) {
    const c = new THREE.Color('#6a2a14').multiplyScalar(0.85 + r() * 0.3)
    g.fillStyle = '#' + c.getHexString(); g.fillRect((i * w) / 12, 0, w / 12, h)
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect((i * w) / 12, 0, 2, h)
  }
}

const STONE = '#eeebe4'
function OilLamp({ position }) {
  const f = useRef()
  useFrame(({ clock }) => { if (f.current) f.current.scale.y = 1 + Math.sin(clock.elapsedTime * 10) * 0.1 })
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} scale={[1, 0.5, 1]}><sphereGeometry args={[0.07, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color="#9a5a32" roughness={0.7} side={THREE.DoubleSide} /></mesh>
      <mesh ref={f} position={[0, 0.07, 0]}><coneGeometry args={[0.018, 0.07, 8]} /><meshBasicMaterial color={[4, 2, 0.6]} toneMapped={false} /></mesh>
      <pointLight position={[0, 0.15, 0]} intensity={0.8} distance={1.5} color="#ffb060" />
    </group>
  )
}
function Buddha({ position, s = 1 }) {
  const base = useMemo(() => new THREE.LatheGeometry([[1.2, 0], [1.25, 0.12], [1.05, 0.22], [1.0, 0.45], [1.12, 0.55], [1.2, 0.7], [1.1, 0.8], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y)), 40), [])
  const torso = useMemo(() => new THREE.LatheGeometry([[0.5, 0], [0.55, 0.3], [0.52, 0.65], [0.58, 0.95], [0.5, 1.1], [0.28, 1.2], [0.14, 1.24], [0, 1.25]].map(([x, y]) => new THREE.Vector2(x, y)), 32), [])
  const st = <meshStandardMaterial color={STONE} roughness={0.45} />
  return (
    <group position={position} scale={s}>
      <mesh geometry={base} castShadow receiveShadow>{st}</mesh>
      {Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return <mesh key={i} position={[Math.sin(a) * 1.12, 0.6, Math.cos(a) * 1.12]} rotation-y={a}><coneGeometry args={[0.12, 0.3, 4]} />{st}</mesh> })}
      <mesh position={[0, 1.05, 0.12]} scale={[1.05, 0.28, 0.62]} castShadow><sphereGeometry args={[1, 32, 20]} />{st}</mesh>
      <mesh geometry={torso} position={[0, 1.15, 0]} scale={[1, 1, 0.75]} castShadow>{st}</mesh>
      <Slab a={[-0.42, 2.25, 0.12]} b={[0.3, 1.25, 0.38]} w={0.22} t={0.04} color={STONE} rough={0.45} />
      <mesh position={[0, 2.5, 0]} castShadow><cylinderGeometry args={[0.12, 0.14, 0.18, 16]} />{st}</mesh>
      <mesh position={[0, 2.82, 0.02]} scale={[0.9, 1.08, 0.92]} castShadow><sphereGeometry args={[0.32, 32, 24]} />{st}</mesh>
      <mesh position={[0, 3.08, -0.01]} castShadow><sphereGeometry args={[0.22, 20, 14]} />{st}</mesh>
      <mesh position={[0, 3.32, -0.01]} castShadow><coneGeometry args={[0.09, 0.4, 12]} />{st}</mesh>
      {[-1, 1].map(k => <mesh key={k} position={[k * 0.3, 2.74, 0.0]} scale={[0.3, 1, 0.5]}><sphereGeometry args={[0.16, 12, 10]} />{st}</mesh>)}
      {/* right hand touching the earth, left hand resting in the lap */}
      <Limb a={[0.55, 2.2, 0]} b={[0.68, 1.55, 0.18]} r={0.13} color={STONE} rough={0.45} />
      <Limb a={[0.68, 1.55, 0.18]} b={[0.55, 1.18, 0.55]} r={0.11} color={STONE} rough={0.45} />
      <Limb a={[-0.55, 2.2, 0]} b={[-0.65, 1.55, 0.15]} r={0.13} color={STONE} rough={0.45} />
      <Limb a={[-0.65, 1.55, 0.15]} b={[-0.12, 1.28, 0.42]} r={0.11} color={STONE} rough={0.45} />
      <mesh position={[-0.05, 1.27, 0.46]} scale={[1.4, 0.4, 1]}><sphereGeometry args={[0.1, 12, 10]} />{st}</mesh>
    </group>
  )
}

function Disciple({ position, rotY }) {
  const robe = useMemo(() => new THREE.LatheGeometry([[0.24, 0], [0.22, 0.6], [0.2, 1.1], [0.23, 1.35], [0.16, 1.45], [0.06, 1.5], [0, 1.5]].map(([x, y]) => new THREE.Vector2(x, y)), 24), [])
  const st = <meshStandardMaterial color={STONE} roughness={0.45} />
  return (
    <group position={position} rotation-y={rotY}>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.3, 0.32, 0.1, 20]} />{st}</mesh>
      <mesh geometry={robe} position={[0, 0.1, 0]} castShadow>{st}</mesh>
      <mesh position={[0, 1.75, 0]} scale={[0.9, 1.1, 0.95]} castShadow><sphereGeometry args={[0.15, 20, 16]} />{st}</mesh>
      {[-1, 1].map(k => (
        <group key={k}>
          <Limb a={[k * 0.2, 1.4, 0]} b={[k * 0.2, 1.12, 0.12]} r={0.055} color={STONE} rough={0.45} />
          <Limb a={[k * 0.2, 1.12, 0.12]} b={[k * 0.025, 1.3, 0.2]} r={0.048} color={STONE} rough={0.45} />
        </group>
      ))}
      <mesh position={[0, 1.36, 0.22]} scale={[0.6, 1.4, 0.6]}><sphereGeometry args={[0.06, 10, 8]} />{st}</mesh>
    </group>
  )
}

function WhiteFlowers({ position }) {
  const pts = useMemo(() => { const r = rnd(position[0] * 10 + 7); return Array.from({ length: 22 }, () => [(r() - 0.5) * 0.4, 0.3 + r() * 0.3, (r() - 0.5) * 0.3]) }, [])
  return (
    <group position={position}>
      <mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.1, 0.08, 0.28, 16]} /><meshStandardMaterial color="#d6a640" metalness={0.8} roughness={0.3} /></mesh>
      {pts.map((p, i) => <mesh key={i} position={p}><icosahedronGeometry args={[0.065, 0]} /><meshStandardMaterial color={i % 4 ? '#f5f3ee' : '#7a9a5c'} roughness={0.8} flatShading /></mesh>)}
    </group>
  )
}

function OfferingStand({ position }) {
  const geo = useMemo(() => new THREE.LatheGeometry([[0.2, 0], [0.22, 0.04], [0.07, 0.1], [0.05, 0.38], [0.09, 0.44], [0.3, 0.5], [0.32, 0.55], [0, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 24), [])
  const buds = useMemo(() => { const r = rnd(9); return Array.from({ length: 12 }, () => { const a = r() * Math.PI * 2, d = 0.06 + r() * 0.16; return [Math.cos(a) * d, 0.62 + r() * 0.08, Math.sin(a) * d, r()] }) }, [])
  return (
    <group position={position}>
      <mesh geometry={geo} castShadow><meshStandardMaterial color="#b3241c" roughness={0.4} /></mesh>
      <mesh position={[0, 0.53, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[0.31, 0.02, 8, 32]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      {buds.map(([x, y, z, k], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh scale={[1, 1.3, 1]}><sphereGeometry args={[0.05, 12, 10]} /><meshStandardMaterial color={k > 0.6 ? '#f4f1ea' : '#c4568a'} roughness={0.7} /></mesh>
          <mesh position={[0, 0.06, 0]}><coneGeometry args={[0.025, 0.05, 8]} /><meshStandardMaterial color={k > 0.6 ? '#f4f1ea' : '#c4568a'} roughness={0.7} /></mesh>
        </group>
      ))}
      <mesh position={[0.02, 0.85, 0]}><coneGeometry args={[0.06, 0.32, 6]} /><meshStandardMaterial color="#d8d2b8" roughness={0.6} /></mesh>
    </group>
  )
}

function TempleHall() {
  const floor = useMemo(() => canvasTex(512, 512, polishedFloor, [3, 2]), [])
  const carve = useMemo(() => canvasTex(64, 512, goldCarve, [1, 3]), [])
  const rug = useMemo(() => canvasTex(512, 256, carpetPattern), [])
  const col = <meshStandardMaterial color="#7a3618" roughness={0.3} />
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[10, 7.4]} /><meshStandardMaterial map={floor} roughness={0.22} metalness={0.15} /></mesh>
      <mesh position={[0, -0.262, 0]}><boxGeometry args={[10.4, 0.5, 7.8]} /><meshStandardMaterial color="#1b0f09" roughness={0.9} /></mesh>
      {/* raised dais */}
      <mesh position={[0, 0.2, -1.95]} castShadow receiveShadow><boxGeometry args={[10, 0.4, 3.5]} /><meshStandardMaterial map={floor} roughness={0.22} metalness={0.15} /></mesh>
      <mesh position={[0, 0.22, -0.18]}><boxGeometry args={[10, 0.06, 0.06]} /><meshStandardMaterial color="#4a1d0c" roughness={0.4} /></mesh>
      <mesh position={[0, 2.75, -3.7]}><boxGeometry args={[10, 5.5, 0.1]} /><meshStandardMaterial color="#2a140a" roughness={0.8} /></mesh>
      {/* dark niche with gilded arches behind the Buddha */}
      <mesh position={[0, 2.75, -3.6]}><boxGeometry args={[3.4, 4.7, 0.08]} /><meshStandardMaterial color="#0f0c0b" roughness={0.9} /></mesh>
      {[-1.2, -0.6, 0, 0.6, 1.2].map(x => <mesh key={x} position={[x, 4.75, -3.53]}><torusGeometry args={[0.3, 0.05, 8, 24, Math.PI]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>)}
      <mesh position={[0, 5.15, -3.53]}><boxGeometry args={[3.6, 0.3, 0.06]} /><meshStandardMaterial map={carve} metalness={0.5} roughness={0.4} /></mesh>
      {[-1.95, 1.95, -2.5, 2.5].map((x, i) => <mesh key={x} position={[x, 2.95, -3.5 + (i > 1 ? 0.1 : 0)]}><boxGeometry args={[0.45, 5.1, 0.08]} /><meshStandardMaterial map={carve} metalness={0.45} roughness={0.4} /></mesh>)}
      {/* columns: front row on the hall floor, back row on the dais */}
      {[-3.9, -2.2, 2.2, 3.9].map(x => (
        <group key={'f' + x} position={[x, 0, -0.05]}>
          <mesh position={[0, 0.15, 0]} castShadow><cylinderGeometry args={[0.44, 0.46, 0.3, 28]} />{col}</mesh>
          <mesh position={[0, 2.9, 0]} castShadow><cylinderGeometry args={[0.34, 0.36, 5.4, 28]} />{col}</mesh>
        </group>
      ))}
      {[-3.4, -1.75, 1.75, 3.4].map(x => (
        <group key={'b' + x} position={[x, 0.4, -1.9]}>
          <mesh position={[0, 0.12, 0]} castShadow><cylinderGeometry args={[0.36, 0.38, 0.24, 24]} />{col}</mesh>
          <mesh position={[0, 2.5, 0]} castShadow><cylinderGeometry args={[0.28, 0.3, 5.0, 24]} />{col}</mesh>
        </group>
      ))}
      <Buddha position={[0, 0.4, -2.85]} />
      <Disciple position={[-1.15, 0.4, -2.35]} rotY={0.35} />
      <Disciple position={[1.15, 0.4, -2.35]} rotY={-0.35} />
      {/* gilded spire and offerings in front of the Buddha */}
      <mesh position={[0, 0.6, -1.65]} castShadow><boxGeometry args={[0.7, 0.4, 0.45]} /><meshStandardMaterial color="#5a1e12" roughness={0.4} /></mesh>
      <CrownSpire position={[0, 0.8, -1.65]} s={1.6} color="#e0ad3e" />
      {[-0.75, 0.75].map(x => <mesh key={x} position={[x, 0.55, -1.55]} castShadow><boxGeometry args={[0.6, 0.3, 0.4]} /><meshStandardMaterial color="#6e2a14" roughness={0.4} /></mesh>)}
      {[-1.1, -0.55, 0.55, 1.1].map(x => <WhiteFlowers key={x} position={[x, 0.7, -1.95]} />)}
      {[-0.55, 0.55].map(x => <OilLamp key={x} position={[x * 1.4, 0.7, -1.5]} />)}
      {/* overhead lamps */}
      {[-1.4, 1.4].map(x => (
        <group key={x} position={[x, 5.0, -1.2]}>
          <mesh><sphereGeometry args={[0.1, 12, 10]} /><meshBasicMaterial color={[4, 3.4, 2.4]} toneMapped={false} /></mesh>
          <spotLight intensity={22} distance={10} angle={0.55} penumbra={0.7} color="#ffe2b4" target-position={[x * 0.2, 1.8, -2.8]} />
        </group>
      ))}
      {/* rug where they kneel */}
      <mesh position={[0, 0.012, 1.55]} rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[3.6, 1.7]} /><meshStandardMaterial map={rug} roughness={0.95} /></mesh>
      <OfferingStand position={[0, 0.012, 1.05]} />
    </group>
  )
}

function World5() {
  const J = (hands) => ({ hip: [0, 0.4, 0], neck: [0, 1.1, 0.02], head: [0, 1.37, 0.05], sh: [[-0.22, 1.02, 0], [0.22, 1.02, 0]], el: hands.el, ha: hands.ha, hp: [[-0.11, 0.38, 0], [0.11, 0.38, 0]], kn: [[-0.13, 0.12, 0.42], [0.13, 0.12, 0.42]], an: [[-0.11, 0.1, -0.12], [0.11, 0.1, -0.12]] })
  const bulanJ = J({ el: [[-0.27, 0.72, 0.12], [0.27, 0.72, 0.12]], ha: [[-0.12, 0.5, 0.33], [0.12, 0.5, 0.33]] })
  const phimJ = J({ el: [[-0.24, 0.78, 0.2], [0.24, 0.78, 0.2]], ha: [[-0.025, 1.0, 0.27], [0.025, 1.0, 0.27]] })
  return (
    <>
      <color attach="background" args={['#0b0705']} />
      <fog attach="fog" args={['#0b0705', 14, 28]} />
      <ambientLight intensity={0.35} color="#ffd9b0" />
      <hemisphereLight intensity={0.3} color="#ffe6c8" groundColor="#2a1206" />
      <directionalLight position={[2, 7, 6]} intensity={1.1} color="#fff0d8" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0004} />
      <pointLight position={[0, 3.5, -0.8]} intensity={6} distance={7} color="#ffd29a" />
      <TempleHall />
      {/* Mae Khru Bulan, cream silk jacket, low bun with hairpin */}
      <Figure position={[-0.55, 0, 1.45]} rotY={Math.PI} j={bulanJ} top="#efe2c8" sleeve="long" skirt={{ len: 'seated', color: '#ddd0b6' }} bottom="#ddd0b6" barefoot footBack head={{ look: 'bulan', bun: true, earrings: true, yaw: -0.25 }}
        extras={<mesh position={[0.06, 1.45, -0.2]} rotation-z={0.6}><boxGeometry args={[0.1, 0.02, 0.02]} /><meshStandardMaterial color="#d8d8de" metalness={0.9} roughness={0.2} /></mesh>} />
      {/* Lt. Phim, olive jacket, low ponytail, hands together making her wish */}
      <Figure position={[0.55, 0, 1.45]} rotY={Math.PI} j={phimJ} top="#4c5138" torsoR={0.21} sleeve="long" bottom="#1b1c20" barefoot footBack head={{ look: 'phim', pony: true, yaw: 0.2 }} />
      <ContactShadows position={[0, 0.015, 0]} opacity={0.5} scale={12} blur={2.4} far={3} />
    </>
  )
}

const OVERVIEW5 = { cam: [0, 2.3, 6.4], look: [0, 1.7, -1.6] }
const SPOTS5 = [
  { th: 'แม่ครูบุหลัน', en: 'Mae Khru Bulan', pos: [-0.55, 1.85, 1.45], look: [-0.45, 1.1, 1.45], cam: [-0.75, 1.3, 0.0], cast: 'บิ๊นท์ สิรีธร ลีห์อร่ามวัฒน์', quote: 'กว่าจะได้ครองรักกัน ก็ยังต้องฝ่าฟันอุปสรรคอีกมาก ผู้หมวดอาจมีอันตรายถึงชีวิต ผู้หมวดตัดสินใจได้หนา ถ้าผู้หมวดเลือกที่จะไม่อยู่... ฉันจะไม่รั้ง ฉันจะอวยพรให้ผู้หมวดได้เจอคนที่เกื้อหนุน และมีความสุข', to: 'หมวดภีม' },
  { th: 'หมวดภีม', en: 'Police Lt. Phim', pos: [0.55, 1.85, 1.45], look: [0.45, 1.1, 1.45], cam: [0.75, 1.3, 0.0], cast: 'ปุยนุ่น วรางค์ศิริ ธนจรัสวรภัทร์', quote: 'ฉันขอพรจากท่านว่า ขอให้ฉัน และก็แม่ครูบุหลัน ได้อยู่เคียงข้างกันแบบนี้ตลอดไป ไม่ว่าจะอันตรายอะไรก็ตาม ขออย่าทำให้เราสองคนได้พรากออกจากกัน ไหนๆ เราสองคนก็ได้ถูกลิขิตให้เป็น คู่บุญ กันแล้ว ฉันรักแม่ครูบุหลัน...รักมากกว่าใคร', to: 'แม่ครูบุหลัน' },
]

/* ---------- camera fly-to ---------- */
const OVERVIEW = { cam: [0.4, 3.4, 10.6], look: [0.4, 1.8, -1.0] }
function Focus({ shot }) {
  const { camera, controls } = useThree()
  const goal = useRef(null)
  useEffect(() => {
    if (shot) goal.current = { p: new THREE.Vector3(...shot.cam), t: new THREE.Vector3(...shot.look) }
  }, [shot])
  useEffect(() => {
    if (!controls) return
    const stop = () => { goal.current = null }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])
  useFrame((_, dt) => {
    if (!goal.current || !controls) return
    const k = 1 - Math.pow(0.03, dt)
    camera.position.lerp(goal.current.p, k)
    controls.target.lerp(goal.current.t, k)
    controls.update()
    if (camera.position.distanceTo(goal.current.p) < 0.01) goal.current = null
  })
  return null
}

/* ---------- lighting presets ---------- */
const MOODS = {
  day: { label: 'กลางวัน', bg: '#2a211a', amb: 0.75, ambC: '#fff1dc', sun: 2.4, sunC: '#ffe2b8', sunP: [6, 9, 7], bloom: 0.35, thr: 0.9 },
  dusk: { label: 'พลบค่ำ', bg: '#1d130e', amb: 0.32, ambC: '#ffcf9e', sun: 1.3, sunC: '#ff9c55', sunP: [8, 3.5, 5], bloom: 0.7, thr: 0.6 },
  night: { label: 'กลางคืน', bg: '#07060a', amb: 0.06, ambC: '#8fa0d8', sun: 0.0, sunC: '#ffffff', sunP: [6, 9, 7], bloom: 1.25, thr: 0.25 },
}

function Scene({ sceneId, spots, mood, petals, pinsOn, active, pick, turntable, shot }) {
  const m = MOODS[mood]
  const night = mood !== 'day'
  return (
    <>
      {sceneId === 1 ? (
        <>
      <color attach="background" args={[m.bg]} />
      <fog attach="fog" args={[m.bg, 14, 30]} />
      <ambientLight intensity={m.amb} color={m.ambC} />
      <hemisphereLight intensity={mood === 'night' ? 0.05 : 0.25} color="#ffe9cc" groundColor="#2a1408" />
      <directionalLight position={m.sunP} intensity={m.sun} color={m.sunC} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0004} />
      <CandleLights night={night} />

      <Room />
      <Platform />
      <Tier y={1.3} w={6.4} d={0.9} z={-2.95} />
      <Tier y={1.9} w={4.4} d={0.7} z={-3.1} />
      <Tier y={2.5} w={2.2} d={0.6} z={-3.2} />
      <TeacherHead />
      {[[-2.7, 1.3, -2.95, 0.9, 'stone'], [-1.2, 1.9, -3.1, 0.75, 'gold'], [1.2, 1.9, -3.1, 0.75, 'gold'], [2.7, 1.3, -2.95, 0.9, 'stone'], [-1.75, 1.3, -3.0, 0.6, 'gold'], [1.75, 1.3, -3.0, 0.6, 'gold'], [-4.1, 0.0, -3.3, 1.6, 'stone'], [4.1, 0.0, -3.3, 1.6, 'stone']]
        .map(([x, y, z, s, t], i) => <Statue key={i} position={[x, y, z]} s={s} tone={t} />)}
      <Tusk side={-1} />
      <Tusk side={1} />
      {CANDLES.map((p, i) => <Candle key={i} p={p} night={night} />)}
      <Marigolds />
      <Threads />
      <Offerings />
      <Phim />
      <Bulan />
      <Petals on={petals} />
      <ContactShadows position={[0, 0.015, 0]} opacity={0.5} scale={12} blur={2.4} far={4} />

        </>
      ) : sceneId === 2 ? <World2 /> : sceneId === 3 ? <World3 /> : sceneId === 4 ? <World4 /> : <World5 />}

      {pinsOn && spots.map((s, i) => (
        <Html key={i} position={s.pos} center zIndexRange={[20, 0]}>
          <button type="button" className={'pin' + (active === i ? ' on' : '')} onClick={() => pick(i)} aria-label={'ดูข้อมูล ' + s.th}>
            {i + 1}
          </button>
        </Html>
      ))}

      <Focus shot={shot} />
      <OrbitControls makeDefault target={[0.4, 1.8, -1.0]} enableDamping minDistance={3.5} maxDistance={17} maxPolarAngle={Math.PI * 0.49} autoRotate={turntable} autoRotateSpeed={0.6} />
      <EffectComposer>
        <Bloom intensity={sceneId === 1 ? m.bloom : sceneId === 2 ? 0.45 : sceneId === 3 ? 0.35 : sceneId === 4 ? 0.55 : 0.4} luminanceThreshold={sceneId === 1 ? m.thr : 0.85} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette offset={0.3} darkness={0.65} />
      </EffectComposer>
    </>
  )
}

/* ---------- landmarks ---------- */
const SPOTS = [
  { th: 'หมวดภีม', en: 'Police Lt. Phim', pos: [-0.12, 2.15, 0.72], look: [0.35, 1.05, 0.7], cam: [1.4, 1.8, 3.9], cast: 'ปุยนุ่น วรางค์ศิริ ธนจรัสวรภัทร์', body: 'ตำรวจหญิงจากเมืองหลวง มือปราบสายลุยที่เชื่อในหลักฐานมากกว่าคาถา ถูกส่งมาตามคดีปริศนาจนต้องก้าวเข้าสู่โลกของไสยศาสตร์ และได้พบกับแม่ครูบุหลัน คนที่ทำให้ทั้งความเชื่อและหัวใจของเธอสั่นคลอน' },
  { th: 'แม่ครูบุหลัน', en: 'Mae Khru Bulan', pos: [0.65, 2.65, -0.45], look: [1.05, 1.45, -0.3], cam: [1.95, 2.0, 2.5], cast: 'บิ๊นท์ สิรีธร ลีห์อร่ามวัฒน์', body: 'แม่ครูสาวผู้สืบทอดวิชาอาคมแก่กล้า งดงาม สงบนิ่ง แต่เด็ดขาดเมื่อต้องปราบสิ่งชั่วร้าย ยึดมั่นในครูบาอาจารย์และศีลของตน กระทั่งหมวดภีมเข้ามาในชีวิต และกลายเป็นคู่บุญที่ชะตาลิขิตไว้' },
]

/* ---------- app shell ---------- */
const SCENES = {
  1: { name: 'ห้องของแม่ครู', tab: 'ข่มขลัง', spots: SPOTS, over: OVERVIEW, first: 1 },
  2: { name: 'ห้องเก็บหุ่น', tab: 'ขัดพิธี', spots: SPOTS2, over: OVERVIEW2, first: 0 },
  3: { name: 'กลางป่ายามวิกาล', tab: 'เผาวิญญาณ', spots: SPOTS3, over: OVERVIEW3, first: 0 },
  4: { name: 'ห้องนอน', tab: 'ศีลไม่เสมอกัน', spots: SPOTS4, over: OVERVIEW4, first: 0 },
  5: { name: 'วิหารพระประธาน', tab: 'คู่บุญ', spots: SPOTS5, over: OVERVIEW5, first: 0 },
}

function App() {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const mood = 'dusk'
  const [sceneId, setSceneId] = useState(1)
  const [petals, setPetals] = useState(!reduce)
  const [pinsOn, setPinsOn] = useState(true)
  const [turntable, setTurntable] = useState(false)
  const [ui, setUi] = useState(true)
  const [active, setActive] = useState(0)
  const [shot, setShot] = useState(null)
  useEffect(() => { if (!reduce) setShot({ ...OVERVIEW }) }, [])
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [dur, setDur] = useState(0)
  const [pos, setPos] = useState(0)
  const [noSong, setNoSong] = useState(false)
  const autoStarted = useRef(false)
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const start = () => {
      if (autoStarted.current || a.error) { cleanup(); return }
      a.play().then(() => { autoStarted.current = true; cleanup() }).catch(() => {})
    }
    const cleanup = () => {
      window.removeEventListener('pointerdown', start, true)
      window.removeEventListener('keydown', start, true)
    }
    a.play().then(() => { autoStarted.current = true }).catch(() => {
      window.addEventListener('pointerdown', start, true)
      window.addEventListener('keydown', start, true)
    })
    return cleanup
  }, [])
  const togglePlay = () => {
    const a = audioRef.current
    if (!a || noSong) return
    if (playing) a.pause()
    else a.play().catch(() => setNoSong(true))
  }
  const sc = SCENES[sceneId]
  const spots = sc.spots
  const ref = useRef({ spots, active })
  ref.current = { spots, active, sceneId }
  const pick = i => { setActive(i); setShot({ ...ref.current.spots[i] }) }
  const overview = () => setShot({ ...SCENES[sceneId].over })
  const ORDER = [1, 2, 3, 4, 5]
  const jump = (id, idx) => { setSceneId(id); setActive(idx); setShot({ ...SCENES[id].spots[idx] }) }
  const nextStep = () => {
    const { spots: sp, active: ac, sceneId: sid } = ref.current
    if (ac < sp.length - 1) pick(ac + 1)
    else { const nid = ORDER[(ORDER.indexOf(sid) + 1) % ORDER.length]; jump(nid, 0) }
  }
  const prevStep = () => {
    const { active: ac, sceneId: sid } = ref.current
    if (ac > 0) pick(ac - 1)
    else { const nid = ORDER[(ORDER.indexOf(sid) + ORDER.length - 1) % ORDER.length]; jump(nid, SCENES[nid].spots.length - 1) }
  }

  useEffect(() => {
    const k = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      const { spots: sp, active: ac } = ref.current
      if (key === 'h') setUi(v => !v)
      else if (key === 'p') setPinsOn(v => !v)
      else if (key === 'f') setPetals(v => !v)
      else if (key === 't') setTurntable(v => !v)
      else if (key === 'arrowright') nextStep()
      else if (key === 'arrowleft') prevStep()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const s = spots[active] || spots[0]
  return (
    <div className="app">
      <Canvas shadows dpr={[1, 2]} camera={{ position: reduce ? [0.4, 3.4, 10.6] : [0.4, 2.0, 1.5], fov: 38 }} gl={{ antialias: true }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; document.body.classList.add('ready') }}>
        <Scene sceneId={sceneId} spots={spots} mood={mood} petals={petals && sceneId === 1} pinsOn={pinsOn && ui} active={active} pick={pick} turntable={turntable} shot={shot} />
      </Canvas>
      <audio ref={audioRef} src="./cage-ost.mp3" loop preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={e => setPos(e.target.currentTime)} onLoadedMetadata={e => setDur(e.target.duration)}
        onError={() => setNoSong(true)} />

      {ui && (
        <>
          <header className="head">
            <div className="side">
            <div className="tools" role="group" aria-label="ตัวเลือกการแสดงผล">
            <button type="button" aria-pressed={pinsOn} className={pinsOn ? 'on' : ''} onClick={() => setPinsOn(v => !v)}>หมุด</button>
            {sceneId === 1 && <button type="button" aria-pressed={petals} className={petals ? 'on' : ''} onClick={() => setPetals(v => !v)}>ดาวเรืองร่วง</button>}
            <button type="button" aria-pressed={turntable} className={turntable ? 'on' : ''} onClick={() => setTurntable(v => !v)}>หมุนรอบ</button>
            <button type="button" onClick={overview}>มุมกว้าง</button>
              <button type="button" onClick={() => setUi(false)}>ซ่อน UI</button>
            </div>
            <div className={'player' + (playing ? ' playing' : '') + (noSong ? ' missing' : '')}>
              <div className="disc" aria-hidden="true"></div>
              <div className="meta">
                <span className="song">ขังหัวใจ (Cage)</span>
                <span className="artist">{noSong ? 'ฟังเพลงเต็มได้ที่ปุ่มแดง' : 'Zom Marie · Ost. ข่มขลัง'}</span>
                <input className="seek" type="range" min="0" max={dur || 0} step="0.1" value={Math.min(pos, dur || 0)} aria-label="ตำแหน่งเพลง"
                  onChange={e => { const a = audioRef.current; if (a && dur) { a.currentTime = +e.target.value; setPos(+e.target.value) } }} />
              </div>
              <button type="button" className="pp" aria-label={playing ? 'หยุดเพลง' : 'เล่นเพลง'} onClick={togglePlay}>
                {playing
                  ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.4" height="12" rx="1" fill="currentColor"></rect><rect x="8.6" y="1" width="3.4" height="12" rx="1" fill="currentColor"></rect></svg>
                  : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5 L12.5 7 L3 12.5 Z" fill="currentColor"></path></svg>}
              </button>
              <a className="yt" href="https://www.youtube.com/watch?v=igWedlWk_8g" target="_blank" rel="noopener" aria-label="ฟังเพลงขังหัวใจบน YouTube">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5 L13 8 L4.5 13.5 Z" fill="currentColor"></path></svg>
              </a>
            </div>
            </div>
          </header>

          {sc.line && (
            <figure className="line">
              <figcaption><span>{sc.line.who}</span> พูดกับ {sc.line.to}</figcaption>
              <blockquote>“{sc.line.text}”</blockquote>
            </figure>
          )}

          <aside className="card" aria-live="polite">
            <div className="card-top">
              <span className="num">ฉาก {sceneId} · {SCENES[sceneId].tab} · {String(active + 1).padStart(2, '0')}/{String(spots.length).padStart(2, '0')}</span>
              <div className="nav">
                <button type="button" aria-label="ก่อนหน้า" onClick={prevStep}>‹</button>
                <button type="button" aria-label="ถัดไป" onClick={nextStep}>›</button>
              </div>
            </div>
            <h2>{s.th}</h2>
            <p className="en">{s.en}</p>
            {s.quote
              ? <figure className="said"><blockquote>“{s.quote}”</blockquote><figcaption>พูดกับ{s.to}</figcaption></figure>
              : <p className="body">{s.body}</p>}
            {s.cast && <p className="cast"><span>รับบทโดย</span>{s.cast}</p>}
          </aside>

          <footer className="hint">
            <span>ลากเพื่อหมุน</span><span>เลื่อนเพื่อซูม</span><span>กดหมุดเพื่อซูมดูใกล้</span><span>H ซ่อน UI</span>
            <span className="fan">แฟนเมด ไม่ใช่ของทางการ</span>
          </footer>
        </>
      )}
      {!ui && <button type="button" className="show" onClick={() => setUi(true)}>แสดง UI</button>}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
