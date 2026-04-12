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
});
