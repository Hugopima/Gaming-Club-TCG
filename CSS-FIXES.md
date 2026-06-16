# CSS FIXES PARA SELECTORES VISUALES

Añade estos estilos a tu `<style>` para mejorar la visualización de selectores:

```css
/* Selector visual mejorado */
#card-selector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.card-selector-item {
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 8px;
  border-radius: 8px;
  border: 2px solid transparent;
}

.card-selector-item:hover {
  transform: scale(1.05);
  box-shadow: 0 0 15px rgba(255, 215, 0, 0.5);
}

.card-selector-item.selected {
  border-color: #0f0;
  box-shadow: inset 0 0 10px rgba(0, 255, 0, 0.3);
  transform: scale(1.08);
}

.card-selector-item img {
  width: 100%;
  border-radius: 6px;
  object-fit: cover;
}

/* Modal de búsqueda de cartas */
.mira-cartas-modal {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 20px;
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.mira-cartas-card {
  text-align: center;
  padding: 10px;
  border: 2px solid #fff07c;
  border-radius: 8px;
  background: rgba(255, 240, 124, 0.05);
  cursor: pointer;
  transition: all 0.2s;
}

.mira-cartas-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 20px rgba(255, 240, 124, 0.3);
}

.mira-cartas-card img {
  width: 120px;
  height: 170px;
  object-fit: cover;
  border-radius: 6px;
  display: block;
  margin: 0 auto 8px;
}

.mira-cartas-card .nombre {
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
```

# INSTRUCCIONES DE INTEGRACIÓN

1. Copia el contenido de `bug-fixes.js` y añádelo **ANTES** del cierre `</script>` final en index.html
2. Copia los estilos CSS anteriores y añádelos al `<style>` de index.html
3. En tus funciones de habilidades, reemplaza selectores así:

**ANTES:**
```javascript
abrirSelectorCartas('Elige una', cartas, (selected) => {
  // hacer algo
});
```

**DESPUÉS:**
```javascript
abrirSelectorCartas('Elige una', cartas, (selected) => {
  // hacer algo
}, false);
```

4. Para mirar cartas sin elegir:
```javascript
window.crearModalMiraCartas(
  'Mira las 5 primeras cartas',
  cartas.slice(0, 5),
  true, // permite elegir
  (cartaElegida) => {
    estadoPartida.jugador.mano.push(cartaElegida);
    redibujarMano();
  }
);
```
