// document.addEventListener('DOMContentLoaded', function() {
//     // Reset counter at start
//     let footnoteCounter = 1;
    
//     // Get all footnote references and actual footnotes
//     const footnoteRefs = document.querySelectorAll('.footnote-ref');
//     const footnotes = document.querySelectorAll('.footnotes li');
    
//     // Update footnote references
//     footnoteRefs.forEach((ref, index) => {
//       // Update the displayed number
//       ref.textContent = `${footnoteCounter}`;
      
//       // Update the href to match
//       ref.href = `#fn:${footnoteCounter}`;
      
//       footnoteCounter++;
//     });
    
//     // Update footnote content
//     footnotes.forEach((footnote, index) => {
//       const num = index + 1;
//       // Add number prefix to footnote content
//       footnote.setAttribute('id', `fn:${num}`);
      
//       // Remove return link if you don't want it
//       const returnLink = footnote.querySelector('.reversefootnote');
//       if (returnLink) {
//         returnLink.remove();
//       }
//     });
//   });
  
$(document).ready(function() {
    $('.datatable').DataTable({
        scrollY: true,
        scrollX: true,
        scrollCollapse: true,
        paging: true,
        searching: true,
        ordering: true,
        info: true,
        autoWidth: true,
        responsive: true
    });
});