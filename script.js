/*
    ¡Bienvenido al motor que da vida! (El JavaScript)
    Nuestro objetivo hoy como estudiante: Hacer que la barra de navegación en lo alto
    se vuelva un poco "más delgada" detectando cuando el usuario baja en la web (scroll).
*/

// La regla de oro: Siempre esperar a que el archivo HTML esté 100% construido.
document.addEventListener("DOMContentLoaded", () => {
    
    // 1. VARIABLES PARA EL MENÚ MÓVIL
    // Buscamos el botón (hamburguesa) y el menú por sus IDs
    const menuToggle = document.getElementById("menu-toggle");
    const navMenu = document.getElementById("nav-menu");
    const navLinks = document.querySelectorAll(".nav-links a");

    // Función para abrir/cerrar el menú
    menuToggle.addEventListener("click", () => {
        // .classList.toggle añade la clase si no está, y la quita si ya está.
        // ¡Es como un interruptor de luz!
        menuToggle.classList.toggle("active");
        navMenu.classList.toggle("active");
    });

    // 2. CIERRE AUTOMÁTICO AL HACER CLIC
    // Si el usuario hace clic en una opción (como "Nosotros"), el menú debe cerrarse solo.
    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            menuToggle.classList.remove("active");
            navMenu.classList.remove("active");
        });
    });

    // 3. EFECTO DE SCROLL DINÁMICO EN EL NAVBAR
    const navbar = document.getElementById("navbar");

    window.addEventListener("scroll", () => {
        // Si el usuario ha bajado más de 50px...
        if (window.scrollY > 50) {
            // Añadimos la clase .scrolled que configuramos en CSS (Vuelve el fondo blanco)
            navbar.classList.add("scrolled");
        } else {
            // Si regresa arriba, volvemos a la transparencia original
            navbar.classList.remove("scrolled");
        }
    });

    console.log("¡Sistema de transparencia y fondo global activado!");

    // 4. CARRUSEL DE RELATOS (DESLIZAMIENTO HORIZONTAL)
    const carousel = document.getElementById("hero-story-carousel");
    const btnPrev = document.getElementById("story-prev");
    const btnNext = document.getElementById("story-next");
    
    if (carousel && btnPrev && btnNext) {
        const cards = carousel.querySelectorAll(".story-card");
        console.log("Carrusel iniciado con", cards.length, "tarjetas.");
        let currentIndex = 0;
        let rotateInterval;
        let isAnimating = false;

        function showCard(index, direction) {
            if (isAnimating || index === currentIndex) return;
            console.log(`Cambiando de tarjeta ${currentIndex} a ${index} en dirección ${direction}`);
            isAnimating = true;

            const currentCard = cards[currentIndex];
            const nextCard = cards[index];

            // Limpiamos estados de deslizamiento previos en todas las tarjetas
            cards.forEach(c => {
                c.classList.remove("slide-out-left", "slide-out-right", "slide-in-left");
            });

            if (direction === "next") {
                currentCard.classList.add("slide-out-left");
                currentCard.classList.remove("active");
                nextCard.classList.add("active");
            } else {
                currentCard.classList.add("slide-out-right");
                currentCard.classList.remove("active");
                nextCard.classList.add("slide-in-left");
                void nextCard.offsetWidth; // Force reflow
                nextCard.classList.remove("slide-in-left");
                nextCard.classList.add("active");
            }

            currentIndex = index;

            setTimeout(() => {
                isAnimating = false;
                // Opcional: limpiar las clases de salida después de la animación
                currentCard.classList.remove("slide-out-left", "slide-out-right");
            }, 850); // Ligeramente mayor que la transición de 0.8s
        }

        function nextCard() {
            let nextIndex = (currentIndex + 1) % cards.length;
            showCard(nextIndex, "next");
        }

        function prevCard() {
            let prevIndex = (currentIndex - 1 + cards.length) % cards.length;
            showCard(prevIndex, "prev");
        }

        function startRotation() {
            stopRotation();
            rotateInterval = setInterval(nextCard, 5000);
        }

        function stopRotation() {
            if (rotateInterval) clearInterval(rotateInterval);
        }

        btnNext.addEventListener("click", () => {
            console.log("Click en Siguiente");
            nextCard();
            startRotation();
        });

        btnPrev.addEventListener("click", () => {
            console.log("Click en Anterior");
            prevCard();
            startRotation();
        });

        startRotation();
    } else {
        console.warn("No se encontró el carrusel o sus botones en el DOM.");
    }
});
