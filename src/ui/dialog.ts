export function createDialog(container: HTMLElement, title: string, onClose?: () => void) {
  const shade = document.createElement('div');
  shade.className = 'dialog-shade';
  
  const paper = document.createElement('div');
  paper.className = 'dialog-paper';
  
  const titleText = document.createElement('div');
  titleText.className = 'dialog-title';
  titleText.innerText = title;
  paper.appendChild(titleText);
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'dialog-close';
  const closeImg = document.createElement('img');
  closeImg.src = '/assets/images/X.png';
  closeBtn.appendChild(closeImg);
  closeBtn.onclick = () => {
    shade.remove();
    onClose?.();
  };
  paper.appendChild(closeBtn);
  
  shade.appendChild(paper);
  container.appendChild(shade);
  
  return { shade, paper };
}
