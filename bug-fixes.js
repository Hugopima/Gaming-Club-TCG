/**
 * BUG FIXES - Gaming Club TCG
 * Soluciones para:
 * 1. Sistema de "mirar cartas" (reusable modal)
 * 2. Permitir sacrificios durante combate
 * 3. Mostrar cartas en selectores (no nombres)
 * 4. Actualización visual en tiempo real de buffs
 * 5. Habilidades "al jugar" que no se aplicaban
 */

// ===== 1. MODAL REUTILIZABLE PARA MIRAR CARTAS =====
window.crearModalMiraCartas = function(titulo, cartas, puedeElegir = false, callback = null) {
  const modal = document.createElement('div');
  modal.className = 'game-modal';
  modal.style.zIndex = '2500';
  
  const cartasHTML = cartas.map((card, idx) => `
    <div style="text-align: center; margin: 10px; cursor: ${puedeElegir ? 'pointer' : 'default'};" 
         onclick="${puedeElegir ? `window._selecionarCartaMirada(${idx})` : ''}">
      <img src="${card.img || 'imagenes/back.png'}" 
           style="width: 120px; height: 170px; border: 2px solid #fff07c; border-radius: 8px; object-fit: cover;"
           alt="${card.nombre}">
      <p style="color: #fff; font-weight: bold;">${card.nombre}</p>
    </div>
  `).join('');

  const content = `
    <div class="game-modal-panel" style="width: min(800px, 90vw);">
      <button class="close-btn" onclick="this.parentElement.parentElement.remove()">×</button>
      <h2 style="color: #fff07c;">${titulo}</h2>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin: 20px 0;">
        ${cartasHTML}
      </div>
      ${puedeElegir ? '' : '<p style="color: #ddd; text-align: center; margin-top: 20px;">Haz clic en el X para cerrar</p>'}
    </div>
  `;
  
  modal.innerHTML = content;
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  
  window._selecionarCartaMirada = function(idx) {
    if (callback) callback(cartas[idx], idx);
    modal.remove();
  };
  
  document.body.appendChild(modal);
  return modal;
};

// ===== 2. SISTEMA DE SACRIFICIO EN COMBATE =====
window.permitirSacrificioEnCombate = function(unidadAtacante, rival) {
  // Obtener unidades propias que pueda sacrificar
  const misCampo = estadoPartida.jugador.campo.unidades || [];
  const sacrificables = misCampo.filter(u => u.id !== unidadAtacante.id);
  
  if (sacrificables.length === 0) return false;
  
  const modal = document.createElement('div');
  modal.className = 'game-modal';
  modal.style.zIndex = '2400';
  
  const cartasHTML = sacrificables.map((card, idx) => `
    <div style="text-align: center; margin: 10px; cursor: pointer;" 
         onclick="window._sacrificarParaCombo(${idx})">
      <img src="${card.img || 'imagenes/back.png'}" 
           style="width: 100px; height: 140px; border: 2px solid #ff6b6b; border-radius: 8px; object-fit: cover;"
           alt="${card.nombre}">
      <p style="color: #ff6b6b; font-weight: bold;">${card.nombre}</p>
    </div>
  `).join('');

  const content = `
    <div class="game-modal-panel" style="width: min(700px, 90vw);">
      <button class="close-btn" onclick="window._cancelarSacrificio()">×</button>
      <h2 style="color: #fff07c;">⚡ Sacrificar unidades para combate</h2>
      <p style="color: #ddd; text-align: center;">Elige unidades para sacrificar y aumentar el poder de tu ataque</p>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 15px; margin: 20px 0;">
        ${cartasHTML}
      </div>
      <button class="plate-btn" onclick="window._confirmarSacrificio()" style="margin-top: 20px;">Confirmar Sacrificios</button>
    </div>
  `;
  
  modal.innerHTML = content;
  
  window._unidadesASacrificar = [];
  
  window._sacrificarParaCombo = function(idx) {
    const card = sacrificables[idx];
    if (!window._unidadesASacrificar.includes(card.id)) {
      window._unidadesASacrificar.push(card.id);
      // Marcar visualmente
      document.querySelectorAll('.game-modal-panel img')[idx].style.opacity = '0.5';
      document.querySelectorAll('.game-modal-panel img')[idx].parentElement.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
    }
  };
  
  window._confirmarSacrificio = function() {
    // Aplicar bonificación de poder
    let bonusPoder = 0;
    window._unidadesASacrificar.forEach(id => {
      const unit = sacrificables.find(u => u.id === id);
      if (unit) bonusPoder += unit.poder * 0.5; // 50% del poder
    });
    
    unidadAtacante.buffs.poder += bonusPoder;
    unidadAtacante.sacrificios = window._unidadesASacrificar;
    
    // Remover unidades sacrificadas
    window._unidadesASacrificar.forEach(id => {
      const idx = estadoPartida.jugador.campo.unidades.findIndex(u => u.id === id);
      if (idx !== -1) estadoPartida.jugador.campo.unidades.splice(idx, 1);
    });
    
    modal.remove();
    redibujarBattlefield();
  };
  
  window._cancelarSacrificio = function() {
    window._unidadesASacrificar = [];
    modal.remove();
  };
  
  document.body.appendChild(modal);
  return true;
};

// ===== 3. FIX: MOSTRAR CARTAS EN SELECTORES (no nombres) =====
window.abrirSelectorCartas = function(titulo, cartas, callback, allowMultiple = false) {
  const modal = document.createElement('div');
  modal.className = 'game-modal';
  modal.style.zIndex = '2350';
  
  let seleccionadas = [];
  
  const cartasHTML = cartas.map((card, idx) => `
    <div style="text-align: center; margin: 10px; cursor: pointer; transition: all 0.2s;" 
         id="card-selector-${idx}"
         onclick="window._toggleSeleccionar(${idx})">
      <img src="${card.img || 'imagenes/back.png'}" 
           style="width: 110px; height: 155px; border: 3px solid #fff07c; border-radius: 8px; object-fit: cover;"
           alt="${card.nombre}">
      <p style="color: #fff; font-weight: bold; margin: 8px 0 0 0; font-size: 12px;">${card.nombre}</p>
    </div>
  `).join('');

  const content = `
    <div class="game-modal-panel" style="width: min(850px, 92vw);">
      <button class="close-btn" onclick="window._cerrarSelector()">×</button>
      <h2 style="color: #fff07c;">${titulo}</h2>
      <p style="color: #ddd; text-align: center; margin: 10px 0;">Haz clic en una carta para seleccionarla ${allowMultiple ? '(puedes seleccionar múltiples)' : ''}</p>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 15px; margin: 20px 0;">
        ${cartasHTML}
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <button class="plate-btn" onclick="window._confirmarSelector()" style="margin-right: 10px;">Confirmar</button>
        <button class="plate-btn btn-nav" onclick="window._cerrarSelector()">Cancelar</button>
      </div>
    </div>
  `;
  
  modal.innerHTML = content;
  
  window._toggleSeleccionar = function(idx) {
    if (allowMultiple) {
      const idx2 = seleccionadas.indexOf(idx);
      if (idx2 !== -1) {
        seleccionadas.splice(idx2, 1);
        document.getElementById(`card-selector-${idx}`).style.opacity = '1';
        document.getElementById(`card-selector-${idx}`).style.transform = 'scale(1)';
      } else {
        seleccionadas.push(idx);
        document.getElementById(`card-selector-${idx}`).style.opacity = '0.8';
        document.getElementById(`card-selector-${idx}`).style.transform = 'scale(1.05)';
      }
    } else {
      seleccionadas = [idx];
      document.querySelectorAll('[id^="card-selector-"]').forEach((el, i) => {
        if (i === idx) {
          el.style.opacity = '0.8';
          el.style.transform = 'scale(1.08)';
          el.style.boxShadow = '0 0 20px rgba(255, 215, 0, 0.8)';
        } else {
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
          el.style.boxShadow = 'none';
        }
      });
    }
  };
  
  window._confirmarSelector = function() {
    const selected = seleccionadas.map(idx => cartas[idx]);
    if (callback) callback(selected);
    modal.remove();
  };
  
  window._cerrarSelector = function() {
    seleccionadas = [];
    modal.remove();
  };
  
  document.body.appendChild(modal);
};

// ===== 4. ACTUALIZAR PODER EN TIEMPO REAL =====
window.actualizarPoderenCampo = function() {
  // Jugador
  document.querySelectorAll('[data-card-id]').forEach(el => {
    const cardId = el.dataset.cardId;
    const unit = estadoPartida.jugador.campo?.unidades?.find(u => u.id === cardId);
    if (unit) {
      const powerEl = el.querySelector('.card-power-badge');
      if (powerEl) {
        const poderTotal = unit.poder + unit.buffs.poder;
        powerEl.textContent = poderTotal;
        if (unit.buffs.poder > 0) {
          powerEl.style.color = '#0f0';
          powerEl.style.textShadow = '0 0 10px rgba(0, 255, 0, 0.8)';
        }
      }
    }
  });
};

// ===== 5. FIX: CARTAS EXTRA (PLAY) APLICAN EFECTO AL JUGAR =====
window.jugarCartaExtra = function(cardId) {
  const carta = buscarCartaEnMano(cardId);
  if (!carta) return;
  
  // Verificar coste
  if (!puedeJugar(carta)) {
    alert('No tienes suficiente maná');
    return;
  }
  
  // APLICAR EFECTO INMEDIATAMENTE (no desde botón en mano)
  if (carta.habilidades) {
    carta.habilidades.forEach(hab => {
      if (hab.tag === 'Activar' && hab.desc.includes('Principal')) {
        ejecutarHabilidad(carta, hab);
      }
    });
  }
  
  // Restar maná
  estadoPartida.jugador.mana.activo -= carta.costeTotal;
  
  // Remover de mano
  const idx = estadoPartida.jugador.mano.indexOf(carta);
  if (idx !== -1) estadoPartida.jugador.mano.splice(idx, 1);
  
  redibujarMano();
  actualizarHUD();
};

// ===== ANIMACIÓN: CARTA VA A LA MANO =====
window.animarCartaAlaMano = function(cartaElement, duracion = 600) {
  if (!cartaElement) return;
  
  cartaElement.style.transition = `all ${duracion}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  const handZone = document.getElementById('player-hand-zone');
  const rect = handZone.getBoundingClientRect();
  
  cartaElement.style.position = 'fixed';
  cartaElement.style.left = rect.left + rect.width / 2 + 'px';
  cartaElement.style.top = rect.top - 50 + 'px';
  cartaElement.style.transform = 'scale(1.2)';
  
  setTimeout(() => {
    cartaElement.style.opacity = '0';
    setTimeout(() => cartaElement.remove(), 100);
  }, duracion);
};

// ===== ANIMACIÓN: CARTA SE DESCARTA =====
window.animarCartaDescarte = function(cartaElement, duracion = 600) {
  if (!cartaElement) return;
  
  cartaElement.style.transition = `all ${duracion}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  const dropZone = document.getElementById('player-drop-zone');
  const rect = dropZone.getBoundingClientRect();
  
  cartaElement.style.position = 'fixed';
  cartaElement.style.left = rect.left + 'px';
  cartaElement.style.top = rect.top + 'px';
  cartaElement.style.transform = 'rotate(15deg) scale(0.8)';
  
  setTimeout(() => {
    cartaElement.style.opacity = '0';
    setTimeout(() => cartaElement.remove(), 100);
  }, duracion);
};

console.log('✅ Bug fixes cargados: Selector de cartas visual, sacrificios, animaciones');
